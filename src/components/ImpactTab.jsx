// Labor hours and cost at risk for the detected misses, and the ranked fix queue.
// All math is in src/impact/impact.js; every assumption below is editable and
// the page recomputes live. Nothing here is measured: the data is synthetic.

import { useEffect, useMemo, useState } from 'react';
import { loadDatabase } from '../db/client.js';
import { EXPECTED_FINDINGS } from '../db/expected-findings.js';
import { loadMissRecords } from '../impact/misses.js';
import { DEFAULT_ASSUMPTIONS, SORTS, estimateImpact, rankQueue } from '../impact/impact.js';

const money = (v) => `$${Math.round(v).toLocaleString()}`;
const hours = (v) => v.toFixed(1);

function NumberField({ label, value, onChange, step = 1, min = 0, max, suffix }) {
  return (
    <label className="flex items-center justify-between gap-3 text-[12px] text-slate-400">
      <span>{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          value={value}
          step={step}
          min={min}
          max={max}
          onChange={(e) => onChange(Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : 0)}
          className="w-20 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-right font-mono text-[12px] text-slate-200"
        />
        {suffix && <span className="w-8 text-[11px] text-slate-600">{suffix}</span>}
      </span>
    </label>
  );
}

const Stat = ({ label, value, note }) => (
  <div className="rounded border border-slate-800 bg-slate-900/40 px-4 py-3">
    <div className="text-[11px] tracking-wide text-slate-500 uppercase">{label}</div>
    <div className="mt-1 font-mono text-[20px] text-slate-100">{value}</div>
    {note && <div className="mt-0.5 text-[11px] text-slate-500">{note}</div>}
  </div>
);

export default function ImpactTab() {
  const [state, setState] = useState({ status: 'loading', misses: null, error: null });
  const [a, setA] = useState(DEFAULT_ASSUMPTIONS);
  const [sort, setSort] = useState('total');

  useEffect(() => {
    let cancelled = false;
    loadDatabase()
      .then((db) => {
        if (!cancelled) setState({ status: 'ready', misses: loadMissRecords(db), error: null });
      })
      .catch((error) => {
        if (!cancelled) setState({ status: 'error', misses: null, error: error.message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const result = useMemo(
    () => (state.misses ? estimateImpact(state.misses, EXPECTED_FINDINGS, a) : null),
    [state.misses, a],
  );

  if (state.status === 'loading') return <p className="text-[13px] text-slate-500">Loading…</p>;
  if (state.status === 'error') return <p className="font-mono text-[13px] text-rose-400">{state.error}</p>;

  const set = (patch) => setA((prev) => ({ ...prev, ...patch }));
  const setProc = (id, patch) =>
    setA((prev) => ({ ...prev, procedures: { ...prev.procedures, [id]: { ...prev.procedures[id], ...patch } } }));
  const setEffort = (cls, v) => setA((prev) => ({ ...prev, fixEffortHours: { ...prev.fixEffortHours, [cls]: v } }));

  const queue = rankQueue(result.queue, sort);
  const { totals } = result;
  const changed = JSON.stringify(a) !== JSON.stringify(DEFAULT_ASSUMPTIONS);

  return (
    <div className="space-y-8">
      <p className="max-w-3xl text-[13px] leading-relaxed text-slate-500">
        Each detected miss is converted into labor hours (the manual work to find and recover it) and
        cost at risk (that labor plus the chance it caused real downstream cost). Every number below
        is an assumption on synthetic data, set low on purpose. Change any of them and the page
        recomputes.
      </p>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Misses" value={totals.misses} note={`in ${a.windowDays} days`} />
        <Stat label="Labor hours" value={hours(totals.hours)} note="manual recovery effort" />
        <Stat label="Cost at risk" value={money(totals.total)} note={`${money(totals.labor)} labor + ${money(totals.risk)} risk`} />
        <Stat
          label="Annualised"
          value={money(totals.total * result.annualFactor)}
          note="window total x 365/14, if representative"
        />
      </section>

      {/* Fix queue ------------------------------------------------------------ */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[13px] font-semibold text-slate-200">Fix queue</h2>
          <div className="flex items-center gap-1 text-[12px]">
            <span className="mr-1 text-slate-500">Rank by</span>
            {Object.entries(SORTS).map(([id, s]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSort(id)}
                className={`rounded px-2.5 py-1 ${sort === id ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:bg-slate-800'}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1 max-w-3xl text-[12px] text-slate-500">
          One row per fix. Fixes group the misses that share a cause, taken from the hand-written
          diagnosis (the answer key). Payback is how many weeks of avoided cost repay the engineering
          effort to build the fix.
        </p>
        <div className="mt-3 overflow-x-auto rounded border border-slate-800">
          <table className="w-full text-[12px]">
            <thead className="bg-slate-900/60 text-[11px] tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-3 py-2 text-right font-medium">#</th>
                <th className="px-3 py-2 text-left font-medium">Fix</th>
                <th className="px-3 py-2 text-left font-medium">Cause</th>
                <th className="px-3 py-2 text-right font-medium">Misses</th>
                <th className="px-3 py-2 text-right font-medium">Hours</th>
                <th className="px-3 py-2 text-right font-medium">Cost at risk</th>
                <th className="px-3 py-2 text-right font-medium">Effort (h)</th>
                <th className="px-3 py-2 text-right font-medium">Payback (wk)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {queue.map((q, i) => (
                <tr key={q.key} className="text-slate-300">
                  <td className="px-3 py-2 text-right font-mono text-slate-500">{i + 1}</td>
                  <td className="px-3 py-2">{q.title}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-sky-300">{q.causeClass}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">{q.misses}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">{hours(q.hours)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-amber-300">{money(q.total)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">{q.effortHours}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">
                    {Number.isFinite(q.paybackWeeks) ? q.paybackWeeks.toFixed(1) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Assumptions ----------------------------------------------------------- */}
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-slate-200">Assumptions</h2>
          <button
            type="button"
            disabled={!changed}
            onClick={() => setA(DEFAULT_ASSUMPTIONS)}
            className="rounded px-2.5 py-1 text-[12px] text-slate-400 enabled:hover:bg-slate-800 disabled:opacity-40"
          >
            Reset to defaults
          </button>
        </div>
        <div className="mt-3 grid gap-6 lg:grid-cols-2">
          <div className="space-y-2 rounded border border-slate-800 bg-slate-900/40 p-4">
            <NumberField label="Loaded labor rate" value={a.laborRate} onChange={(v) => set({ laborRate: v })} suffix="$/h" />
            <NumberField
              label="Chance a miss causes real cost"
              value={a.impactProbability}
              step={0.05}
              max={1}
              onChange={(v) => set({ impactProbability: v })}
            />
            <NumberField
              label="Weight on bypassed misses"
              value={a.bypassWeight}
              step={0.1}
              max={1}
              onChange={(v) => set({ bypassWeight: v })}
            />
            <p className="pt-2 text-[11px] leading-relaxed text-slate-600">
              A bypassed miss is one where a recorded exception (such as a port in maintenance mode)
              explains why nothing fired. Counting it at half weight is the conservative middle:
              someone may have meant the automation to stand down, but the case was still never
              picked up.
            </p>
            <h3 className="pt-3 text-[11px] tracking-wide text-slate-500 uppercase">Fix effort by cause (hours)</h3>
            {Object.keys(a.fixEffortHours).map((cls) => (
              <NumberField key={cls} label={cls} value={a.fixEffortHours[cls]} onChange={(v) => setEffort(cls, v)} suffix="h" />
            ))}
          </div>

          <div className="overflow-x-auto rounded border border-slate-800">
            <table className="w-full text-[12px]">
              <thead className="bg-slate-900/60 text-[11px] tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Procedure</th>
                  <th className="px-3 py-2 text-right font-medium">Misses</th>
                  <th className="px-3 py-2 text-right font-medium">Manual h / miss</th>
                  <th className="px-3 py-2 text-right font-medium">$ if it bites</th>
                  <th className="px-3 py-2 text-right font-medium">Cost at risk</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {result.perProcedure.map((p) => (
                  <tr key={p.asopId} className="text-slate-300">
                    <td className="px-3 py-1.5 font-mono text-slate-200">{p.asopId}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-400">{p.misses}</td>
                    <td className="px-3 py-1.5 text-right">
                      <input
                        type="number"
                        step="0.25"
                        min="0"
                        value={a.procedures[p.asopId].manualHours}
                        onChange={(e) => setProc(p.asopId, { manualHours: e.target.valueAsNumber || 0 })}
                        className="w-16 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-right font-mono text-slate-200"
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <input
                        type="number"
                        step="50"
                        min="0"
                        value={a.procedures[p.asopId].consequence}
                        onChange={(e) => setProc(p.asopId, { consequence: e.target.valueAsNumber || 0 })}
                        className="w-20 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-right font-mono text-slate-200"
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-amber-300">{money(p.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="max-w-3xl text-[12px] leading-relaxed text-slate-500">
        <h2 className="text-[13px] font-semibold text-slate-200">How to read this, and its limits</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            Per miss: hours = manual hours x weight; cost at risk = hours x labor rate + chance x
            consequence x weight.
          </li>
          <li>The inputs are illustrative, not measured. The structure is the point; real numbers would come from a labor log and a cost ledger.</li>
          <li>
            The annualised figure assumes these 14 days are representative. Two weeks of synthetic data
            cannot support a forecast, so treat it as a scale check.
          </li>
          <li>
            Cost at risk is not the same as realised loss. With a {Math.round(a.impactProbability * 100)}%
            chance of real damage, most misses cost only their recovery labor.
          </li>
        </ul>
      </section>
    </div>
  );
}
