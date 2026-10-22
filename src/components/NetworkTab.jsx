// The station network: the route batches take, and how long they spend at each
// stage and between stages. Computed by SQLite at page load, same as the Audit
// tab. Context for the audit, and the raw material the SPC layer builds on.

import { useEffect, useState } from 'react';
import { loadDatabase } from '../db/client.js';
import { runQuery } from '../db/query.js';

const MINUTES = (a, b) => `(julianday(${b}) - julianday(${a})) * 1440`;

const DWELL_SQL = `
  SELECT s.station_id, s.name, s.seq, s.lane,
         COUNT(*) AS batches,
         ROUND(AVG(${MINUTES('v.arrived_at', 'v.departed_at')}), 1) AS avg_dwell,
         ROUND(MAX(${MINUTES('v.arrived_at', 'v.departed_at')}), 1) AS max_dwell
  FROM station_visits v JOIN stations s ON s.station_id = v.station_id
  GROUP BY s.station_id ORDER BY s.seq, s.station_id`;

const HANDOFF_SQL = `
  SELECT h.from_station, h.to_station,
         COUNT(*) AS moves,
         ROUND(AVG(${MINUTES('h.departed_at', 'h.arrived_at')}), 1) AS avg_gap,
         ROUND(MAX(${MINUTES('h.departed_at', 'h.arrived_at')}), 1) AS max_gap
  FROM station_handoffs h JOIN stations f ON f.station_id = h.from_station
  GROUP BY h.from_station, h.to_station ORDER BY f.seq, h.from_station`;

const Cell = ({ children }) => (
  <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">{children}</td>
);

const Head = ({ children, right }) => (
  <th className={`px-3 py-2 font-medium ${right ? 'text-right' : 'text-left'}`}>{children}</th>
);

export default function NetworkTab() {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    loadDatabase()
      .then((db) => {
        const dwell = runQuery(db, DWELL_SQL);
        const handoffs = runQuery(db, HANDOFF_SQL);
        if (!dwell.ok || !handoffs.ok) throw new Error(dwell.error ?? handoffs.error);
        if (!cancelled) {
          setState({ status: 'ready', data: { dwell: dwell.rows, handoffs: handoffs.rows }, error: null });
        }
      })
      .catch((error) => {
        if (!cancelled) setState({ status: 'error', data: null, error: error.message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === 'loading') return <p className="text-[13px] text-slate-500">Loading…</p>;
  if (state.status === 'error') {
    return <p className="font-mono text-[13px] text-rose-400">{state.error}</p>;
  }

  const { dwell, handoffs } = state.data;
  const stages = [...new Set(dwell.map((row) => row.seq))].map((seq) => ({
    seq,
    rows: dwell.filter((row) => row.seq === seq),
  }));

  return (
    <div className="space-y-8">
      <p className="max-w-3xl text-[13px] leading-relaxed text-slate-500">
        Batches move through six stages. Process runs on two parallel lanes that do the
        same job, so any batch takes one or the other. Dwell is time spent at a station;
        a handoff gap is the time between leaving one station and arriving at the next.
      </p>

      <section>
        <h2 className="text-[13px] font-semibold text-slate-200">Route</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {stages.map((stage, index) => (
            <div key={stage.seq} className="flex items-center gap-2">
              <div className="rounded border border-slate-800 bg-slate-900/50 px-3 py-2">
                <div className="text-[12px] font-medium text-slate-200">{stage.rows[0].name}</div>
                <div className="font-mono text-[11px] text-slate-500">
                  {stage.rows.map((row) => row.station_id).join(' · ')}
                </div>
              </div>
              {index < stages.length - 1 && <span className="text-slate-600">&rarr;</span>}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-[13px] font-semibold text-slate-200">Dwell by station (minutes)</h2>
        <div className="mt-3 overflow-hidden rounded border border-slate-800">
          <table className="w-full text-[12px]">
            <thead className="bg-slate-900/60 text-[11px] tracking-wide text-slate-500 uppercase">
              <tr>
                <Head>Station</Head>
                <Head>Name</Head>
                <Head right>Batches</Head>
                <Head right>Avg</Head>
                <Head right>Max</Head>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {dwell.map((row) => (
                <tr key={row.station_id}>
                  <td className="px-3 py-2 font-mono text-slate-200">{row.station_id}</td>
                  <td className="px-3 py-2 text-slate-300">
                    {row.name}
                    {row.lane ? ` (lane ${row.lane})` : ''}
                  </td>
                  <Cell>{row.batches}</Cell>
                  <Cell>{row.avg_dwell}</Cell>
                  <Cell>{row.max_dwell}</Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-[13px] font-semibold text-slate-200">Handoff gaps (minutes)</h2>
        <div className="mt-3 overflow-hidden rounded border border-slate-800">
          <table className="w-full text-[12px]">
            <thead className="bg-slate-900/60 text-[11px] tracking-wide text-slate-500 uppercase">
              <tr>
                <Head>From</Head>
                <Head>To</Head>
                <Head right>Moves</Head>
                <Head right>Avg</Head>
                <Head right>Max</Head>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {handoffs.map((row) => (
                <tr key={`${row.from_station}-${row.to_station}`}>
                  <td className="px-3 py-2 font-mono text-slate-200">{row.from_station}</td>
                  <td className="px-3 py-2 font-mono text-slate-200">{row.to_station}</td>
                  <Cell>{row.moves}</Cell>
                  <Cell>{row.avg_gap}</Cell>
                  <Cell>{row.max_gap}</Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
