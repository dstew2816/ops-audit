// Statistical process control for the station network. All readings come out of
// SQLite (station_measurements) and all statistics come from src/spc/spc.js, the
// same code scripts/spc-check.mjs verifies.

import { useEffect, useMemo, useState } from 'react';
import { loadDatabase } from '../db/client.js';
import { runQuery } from '../db/query.js';
import { BASELINE, RULES, analyzeStation, pairDrift } from '../spc/spc.js';
import { formatTimestamp } from '../engine/time.js';
import ControlChart from './ControlChart.jsx';

const fmt = (value, digits = 2) => Number(value).toFixed(digits);

// Cpk bands used by most industries: 1.33 is the usual "capable" bar.
function capabilityBand(cpk) {
  if (cpk >= 1.33) return { label: 'Capable', cls: 'text-emerald-300' };
  if (cpk >= 1.0) return { label: 'Marginal', cls: 'text-amber-300' };
  return { label: 'Not capable', cls: 'text-rose-300' };
}

export default function SpcTab() {
  const [state, setState] = useState({ status: 'loading', rows: null, specs: null, error: null });
  const [station, setStation] = useState('ST-3B');
  const [view, setView] = useState('xbar');

  useEffect(() => {
    let cancelled = false;
    loadDatabase()
      .then((db) => {
        const specs = runQuery(db, 'SELECT * FROM station_specs ORDER BY station_id');
        const rows = runQuery(db, 'SELECT * FROM station_measurements ORDER BY station_id, subgroup, seq', { maxRows: 5000 });
        if (!specs.ok || !rows.ok) throw new Error(specs.error ?? rows.error);
        if (!cancelled) setState({ status: 'ready', rows: rows.rows, specs: specs.rows, error: null });
      })
      .catch((error) => {
        if (!cancelled) setState({ status: 'error', rows: null, specs: null, error: error.message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const analysis = useMemo(() => {
    if (state.status !== 'ready') return null;
    const byStation = {};
    for (const spec of state.specs) {
      byStation[spec.station_id] = {
        spec,
        ...analyzeStation(state.rows.filter((r) => r.station_id === spec.station_id), spec),
      };
    }
    return byStation;
  }, [state]);

  if (state.status === 'loading') return <p className="text-[13px] text-slate-500">Loading…</p>;
  if (state.status === 'error') return <p className="font-mono text-[13px] text-rose-400">{state.error}</p>;

  const ids = Object.keys(analysis);
  const current = analysis[station];
  const labels = current.groups.map((g) => `Subgroup ${g.subgroup} (${formatTimestamp(g.measuredAt)})`);

  const alerts = ids
    .flatMap((id) =>
      [...analysis[id].xbarHits.map((h) => ({ ...h, chart: 'X-bar' })), ...analysis[id].rangeHits.map((h) => ({ ...h, chart: 'R' }))].map(
        (h) => ({ id, ...h, at: analysis[id].groups[h.index].measuredAt }),
      ),
    )
    // collapse repeated rules at one point into the most severe label
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));

  const drift = pairDrift(analysis['ST-3A'].chart.means, analysis['ST-3B'].chart.means);
  const driftLabels = drift.diff.map((_, i) => `Subgroup ${i}`);

  return (
    <div className="space-y-12">
      <p className="max-w-3xl text-[15px] leading-[1.75] text-slate-400">
        Each station is measured on cycle time, in subgroups of five consecutive units. A control chart draws the
        range of ordinary variation, so a point or pattern outside it suggests that something changed. The control
        limits come from the first {BASELINE} subgroups, which I assume were healthy, and are held fixed afterward.
        Capability is a separate question, because it compares the process with the specification limits.
      </p>

      {/* Capability --------------------------------------------------------- */}
      <section>
        <h2 className="text-[18px] font-semibold tracking-tight text-slate-100">Process capability</h2>
        <p className="mt-2 max-w-3xl text-[14px] leading-[1.7] text-slate-400">
          The process capability index (Cpk) uses the short-term noise within each subgroup, and the process
          performance index (Ppk) uses all of the variation, drift included. When Cpk is well above Ppk, the process
          is capable while stable but did not stay stable.
        </p>
        <div className="mt-3 overflow-x-auto rounded border border-slate-800">
          <table className="w-full text-[12px]">
            <thead className="bg-slate-900/60 text-[11px] tracking-wide text-slate-500 uppercase">
              <tr>
                {['Station', 'Spec (min)', 'Mean', 'Cp', 'Cpk', 'Ppk', 'Verdict', 'Alerts'].map((h, i) => (
                  <th key={h} className={`px-3 py-2 font-medium ${i === 0 || i === 6 ? 'text-left' : 'text-right'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {ids.map((id) => {
                const a = analysis[id];
                const band = capabilityBand(a.capability.cpk);
                const count = a.xbarHits.length + a.rangeHits.length;
                return (
                  <tr
                    key={id}
                    onClick={() => setStation(id)}
                    className={`cursor-pointer ${id === station ? 'bg-slate-800/60' : 'hover:bg-slate-900/60'}`}
                  >
                    <td className="px-3 py-2 font-mono text-slate-200">{id}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">{a.spec.lsl}–{a.spec.usl}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">{fmt(a.capability.mean, 1)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">{fmt(a.capability.cp)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-200">{fmt(a.capability.cpk)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">{fmt(a.capability.ppk)}</td>
                    <td className={`px-3 py-2 ${band.cls}`}>{band.label}</td>
                    <td className={`px-3 py-2 text-right font-mono tabular-nums ${count ? 'text-amber-300' : 'text-slate-600'}`}>{count}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Charts ------------------------------------------------------------- */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[18px] font-semibold tracking-tight text-slate-100">
            Control charts <span className="ml-1 font-mono text-[11px] text-slate-500">{station}</span>
          </h2>
          <div className="flex gap-1 text-[12px]">
            {[['xbar', 'X-bar / R'], ['imr', 'Individuals']].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                className={`rounded px-2.5 py-1 ${view === id ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:bg-slate-800'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ids.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setStation(id)}
              className={`rounded border px-2 py-0.5 font-mono text-[11px] ${id === station ? 'border-sky-500/60 text-sky-300' : 'border-slate-800 text-slate-400 hover:border-slate-600'}`}
            >
              {id}
            </button>
          ))}
        </div>

        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          {view === 'xbar' ? (
            <>
              <ControlChart
                title="X-bar chart: subgroup means"
                values={current.chart.means}
                {...current.chart.xbar}
                hits={current.xbarHits}
                baseline={BASELINE}
                labels={labels}
              />
              <ControlChart
                title="R chart: subgroup ranges"
                values={current.chart.ranges}
                {...current.chart.r}
                hits={current.rangeHits}
                baseline={BASELINE}
                labels={labels}
              />
            </>
          ) : (
            <>
              <ControlChart
                title="Individuals chart: every reading"
                values={current.individuals.values}
                {...current.individuals.i}
                labels={current.individuals.values.map((_, i) => `Reading ${i}`)}
              />
              <ControlChart
                title="Moving range chart"
                values={current.individuals.mr}
                {...current.individuals.mrChart}
                labels={current.individuals.mr.map((_, i) => `Reading ${i + 1}`)}
              />
            </>
          )}
        </div>
        <p className="mt-2 text-[11px] text-slate-600">
          Red points are alerts. The zone lines mark 1 and 2 standard deviations (sigma). Hover a point for its subgroup and time.
        </p>
      </section>

      {/* Drift --------------------------------------------------------------- */}
      <section>
        <h2 className="text-[18px] font-semibold tracking-tight text-slate-100">Cross-station drift: lane A vs lane B</h2>
        <p className="mt-2 max-w-3xl text-[14px] leading-[1.7] text-slate-400">
          The two Process lanes do the same job, so their subgroup means should move together. This chart tracks the
          difference between them (lane B minus lane A), learns what normal looks like from the first{' '}
          {drift.baseline} subgroups, and then applies the same rules.{' '}
          {drift.firstAlert === null
            ? 'No divergence flagged.'
            : `The first divergence alert comes at subgroup ${drift.firstAlert}, and by the end lane B runs about ${fmt(drift.recentMeanGap, 1)} minutes above its normal gap to lane A.`}
        </p>
        <div className="mt-3 max-w-3xl">
          <ControlChart
            title="Difference in subgroup means (lane B − lane A)"
            values={drift.diff}
            cl={drift.cl}
            ucl={drift.ucl}
            lcl={drift.lcl}
            sigma={drift.sigma}
            hits={drift.hits}
            baseline={drift.baseline}
            labels={driftLabels}
          />
        </div>
      </section>

      {/* Alerts -------------------------------------------------------------- */}
      <section>
        <h2 className="text-[18px] font-semibold tracking-tight text-slate-100">
          Alerts <span className="ml-1 font-mono text-[11px] text-slate-500">{alerts.length}</span>
        </h2>
        <div className="mt-3 max-h-80 overflow-auto rounded border border-slate-800">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-slate-900 text-[11px] tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Time</th>
                <th className="px-3 py-2 text-left font-medium">Station</th>
                <th className="px-3 py-2 text-left font-medium">Chart</th>
                <th className="px-3 py-2 text-left font-medium">Rule</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {alerts.map((a, i) => (
                <tr key={i} className="text-slate-300">
                  <td className="px-3 py-1.5 font-mono text-[11px] text-slate-400">{formatTimestamp(a.at)}</td>
                  <td className="px-3 py-1.5 font-mono text-slate-200">{a.id}</td>
                  <td className="px-3 py-1.5 text-slate-400">{a.chart}</td>
                  <td className="px-3 py-1.5 text-slate-400">{a.detail ?? RULES[a.rule]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
