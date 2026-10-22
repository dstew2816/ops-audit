// Statistical process control for the station network. All readings come out of
// SQLite (station_measurements) and all statistics come from src/spc/spc.js, the
// same code scripts/spc-check.mjs verifies.

import { useEffect, useMemo, useState } from 'react';
import { loadDatabase } from '../db/client.js';
import { runQuery } from '../db/query.js';
import { BASELINE, RULES, analyzeStation, pairDrift } from '../spc/spc.js';
import { formatTimestamp } from '../engine/time.js';

const fmt = (value, digits = 2) => Number(value).toFixed(digits);

// Cpk bands used by most industries: 1.33 is the usual "capable" bar.
function capabilityBand(cpk) {
  if (cpk >= 1.33) return { label: 'Capable', cls: 'text-emerald-300' };
  if (cpk >= 1.0) return { label: 'Marginal', cls: 'text-amber-300' };
  return { label: 'Not capable', cls: 'text-rose-300' };
}

/** One control chart as inline SVG: points, centre line, limits, sigma zones. */
function ControlChart({ title, values, cl, ucl, lcl, sigma, hits = [], baseline = null, labels = [] }) {
  const W = 720;
  const H = 230;
  const pad = { l: 48, r: 16, t: 14, b: 26 };
  const flagged = new Set(hits.map((h) => h.index));

  const lo = Math.min(...values, lcl) - (ucl - lcl) * 0.08;
  const hi = Math.max(...values, ucl) + (ucl - lcl) * 0.08;
  const x = (i) => pad.l + (i / Math.max(values.length - 1, 1)) * (W - pad.l - pad.r);
  const y = (v) => pad.t + ((hi - v) / (hi - lo)) * (H - pad.t - pad.b);

  const zones = sigma ? [1, 2].flatMap((k) => [cl + k * sigma, cl - k * sigma]) : [];
  const path = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  return (
    <figure className="rounded border border-slate-800 bg-slate-900/40 p-3">
      <figcaption className="mb-1 flex items-baseline justify-between text-[12px]">
        <span className="font-medium text-slate-200">{title}</span>
        <span className="font-mono text-[11px] text-slate-500">
          UCL {fmt(ucl)} · CL {fmt(cl)} · LCL {fmt(lcl)}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={title}>
        {baseline !== null && (
          <g>
            <line x1={x(baseline - 0.5)} x2={x(baseline - 0.5)} y1={pad.t} y2={H - pad.b} className="stroke-slate-600" strokeDasharray="2 3" />
            <text x={x(baseline - 0.5) + 4} y={pad.t + 9} className="fill-slate-500" fontSize="9">
              limits set from first {baseline} subgroups
            </text>
          </g>
        )}
        {zones.map((v) => (
          <line key={v} x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="stroke-slate-800" />
        ))}
        {[ucl, lcl].map((v, i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="stroke-rose-400/70" strokeDasharray="5 4" />
            <text x={pad.l - 6} y={y(v) + 3} textAnchor="end" className="fill-rose-300" fontSize="10">
              {i === 0 ? 'UCL' : 'LCL'}
            </text>
          </g>
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={y(cl)} y2={y(cl)} className="stroke-slate-500" />
        <text x={pad.l - 6} y={y(cl) + 3} textAnchor="end" className="fill-slate-400" fontSize="10">CL</text>
        <path d={path} fill="none" className="stroke-sky-400/80" strokeWidth="1.5" />
        {values.map((v, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(v)}
            r={flagged.has(i) ? 4.5 : 2.5}
            className={flagged.has(i) ? 'fill-rose-400 stroke-slate-950' : 'fill-sky-300'}
          >
            <title>{`${labels[i] ?? `#${i}`}: ${fmt(v)}${flagged.has(i) ? ' — out of control' : ''}`}</title>
          </circle>
        ))}
        {[0, Math.floor((values.length - 1) / 2), values.length - 1].map((i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="fill-slate-500" fontSize="10">
            {i}
          </text>
        ))}
      </svg>
    </figure>
  );
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
    <div className="space-y-8">
      <p className="max-w-3xl text-[13px] leading-relaxed text-slate-500">
        Each station is measured on cycle time in subgroups of five consecutive units. A control
        chart draws the range of ordinary variation; a point or pattern outside it means something
        changed. Control limits come from the first {BASELINE} subgroups, assumed healthy, and are
        held fixed after that. Capability is a separate question: it compares the process with the
        spec limits.
      </p>

      {/* Capability --------------------------------------------------------- */}
      <section>
        <h2 className="text-[13px] font-semibold text-slate-200">Process capability</h2>
        <p className="mt-1 max-w-3xl text-[12px] text-slate-500">
          Cpk uses short-term noise (within-subgroup). Ppk uses all the variation, drift included. A
          Cpk well above Ppk means the process is capable when stable but did not stay stable.
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
          <h2 className="text-[13px] font-semibold text-slate-200">
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
          Red points are alerts. Zone lines mark 1 and 2 sigma. Hover a point for its subgroup and time.
        </p>
      </section>

      {/* Drift --------------------------------------------------------------- */}
      <section>
        <h2 className="text-[13px] font-semibold text-slate-200">Cross-station drift: lane A vs lane B</h2>
        <p className="mt-1 max-w-3xl text-[12px] text-slate-500">
          The two Process lanes do the same job, so their subgroup means should move together. This
          chart tracks the difference (B minus A). It learns what normal looks like from the first{' '}
          {drift.baseline} subgroups, then applies the same rules.{' '}
          {drift.firstAlert === null
            ? 'No divergence flagged.'
            : `First divergence alert at subgroup ${drift.firstAlert}; by the end B runs about ${fmt(drift.recentMeanGap, 1)} minutes above its normal gap to A.`}
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
        <h2 className="text-[13px] font-semibold text-slate-200">
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
