// Real-data validation on the public UCI SECOM dataset. The page only displays
// ml/real/results/secom_results.json, produced by ml/real/secom_analysis.py.
// Every number is shown as it came out, including the weak ones.

import { useState } from 'react';
import real from '../../ml/real/results/secom_results.json';

const pct = (v, d = 1) => (v === null || v === undefined ? 'n/a' : `${(v * 100).toFixed(d)}%`);
const f3 = (v) => (v === null || v === undefined ? 'n/a' : v.toFixed(3));
const when = (iso) => iso.slice(0, 16).replace('T', ' ');

const d = real.dataset;
const spc = real.spc;
const cls = real.classification;
const bridge = real.bridge;
const MODELS = [
  ['decision_tree', 'Decision tree', '#38bdf8'],
  ['random_forest', 'Random forest', '#34d399'],
  ['logistic_regression', 'Logistic regression', '#fbbf24'],
  ['control_chart_rule', 'Control-chart rule', '#a78bfa'],
  ['majority_class', 'Always predict pass', '#64748b'],
];

function SensorChart({ feature }) {
  const W = 1000;
  const H = 250;
  const pad = { l: 56, r: 12, t: 14, b: 26 };
  const n = real.timestamps.length;
  const vals = feature.values.filter((v) => v !== null).sort((a, b) => a - b);
  const q = (p) => vals[Math.floor(p * (vals.length - 1))];
  const span = feature.ucl - feature.lcl;
  const lo = Math.min(q(0.01), feature.lcl) - span * 0.15;
  const hi = Math.max(q(0.99), feature.ucl) + span * 0.15;
  const x = (i) => pad.l + (i / (n - 1)) * (W - pad.l - pad.r);
  const y = (v) => pad.t + ((hi - Math.max(lo, Math.min(hi, v))) / (hi - lo)) * (H - pad.t - pad.b);
  const signals = feature.signal_runs;

  let path = '';
  let pen = false;
  feature.values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    path += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  });

  return (
    <figure className="rounded border border-slate-800 bg-slate-900/40 p-3">
      <figcaption className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-[12px]">
        <span className="font-medium text-slate-200">Sensor {feature.sensor}: individuals chart, every run in time order</span>
        <span className="font-mono text-[11px] text-slate-500">
          UCL {feature.ucl} · CL {feature.baseline_mean} · LCL {feature.lcl}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Control chart for sensor ${feature.sensor}`}>
        <line x1={x(spc.baseline_runs - 0.5)} x2={x(spc.baseline_runs - 0.5)} y1={pad.t} y2={H - pad.b} className="stroke-slate-600" strokeDasharray="2 3" />
        <text x={x(spc.baseline_runs - 0.5) + 5} y={pad.t + 9} className="fill-slate-500" fontSize="10">
          limits set from the first {spc.baseline_runs} runs
        </text>
        {[feature.ucl, feature.lcl].map((v, i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="stroke-rose-400/70" strokeDasharray="5 4" />
            <text x={pad.l - 6} y={y(v) + 3} textAnchor="end" className="fill-rose-300" fontSize="10">{i === 0 ? 'UCL' : 'LCL'}</text>
          </g>
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={y(feature.baseline_mean)} y2={y(feature.baseline_mean)} className="stroke-slate-500" />
        <text x={pad.l - 6} y={y(feature.baseline_mean) + 3} textAnchor="end" className="fill-slate-400" fontSize="10">CL</text>
        <path d={path} fill="none" className="stroke-sky-400/40" strokeWidth="0.8" />
        {feature.values.map((v, i) => {
          if (v === null) return null;
          const sig = signals[i];
          const after = i >= spc.baseline_runs;
          return (
            <circle
              key={i}
              cx={x(i)}
              cy={y(v)}
              r={sig ? 2.6 : 1.4}
              className={sig ? (after ? 'fill-rose-400' : 'fill-amber-300') : 'fill-sky-300/80'}
            >
              <title>{`Run ${i} (${when(real.timestamps[i])}): ${v}${sig ? ` — ${sig.join(', ')}` : ''}`}</title>
            </circle>
          );
        })}
        {real.failure_runs.map((i) => (
          <line key={i} x1={x(i)} x2={x(i)} y1={H - pad.b + 2} y2={H - pad.b + 10} className="stroke-white/80" strokeWidth="1" />
        ))}
        <text x={pad.l} y={H - 2} className="fill-slate-500" fontSize="10">run 0</text>
        <text x={W - pad.r} y={H - 2} textAnchor="end" className="fill-slate-500" fontSize="10">run {n - 1}</text>
      </svg>
      <p className="mt-1 text-[11px] text-slate-600">
        Red: a run-rule signal after the baseline. Amber: a signal inside the baseline itself. White ticks along the bottom: runs that failed.
        Gaps are missing readings. Values beyond the plotted range are drawn at its edge.
      </p>
    </figure>
  );
}

function PrChart() {
  const W = 420;
  const H = 300;
  const pad = { l: 40, r: 10, t: 10, b: 30 };
  const x = (r) => pad.l + r * (W - pad.l - pad.r);
  const y = (p) => pad.t + (1 - p) * (H - pad.t - pad.b);
  const prevalence = cls.test.fail_rate;
  return (
    <figure className="rounded border border-slate-800 bg-slate-900/40 p-3">
      <figcaption className="mb-1 text-[12px] font-medium text-slate-200">Precision against recall on the test period</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Precision-recall curves">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="stroke-slate-800" />
            <text x={pad.l - 5} y={y(t) + 3} textAnchor="end" className="fill-slate-500" fontSize="9">{t}</text>
            <text x={x(t)} y={H - 14} textAnchor="middle" className="fill-slate-500" fontSize="9">{t}</text>
          </g>
        ))}
        <text x={(W + pad.l) / 2} y={H - 2} textAnchor="middle" className="fill-slate-500" fontSize="10">recall</text>
        <text x={10} y={H / 2} className="fill-slate-500" fontSize="10" transform={`rotate(-90 10 ${H / 2})`} textAnchor="middle">precision</text>
        <line x1={pad.l} x2={W - pad.r} y1={y(prevalence)} y2={y(prevalence)} stroke="#64748b" strokeDasharray="4 3" />
        {MODELS.filter(([id]) => cls.models[id].curve).map(([id, , color]) => (
          <path
            key={id}
            d={cls.models[id].curve.map(([r, p], i) => `${i === 0 ? 'M' : 'L'}${x(r).toFixed(1)},${y(p).toFixed(1)}`).join(' ')}
            fill="none"
            stroke={color}
            strokeWidth="1.4"
          />
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
        {MODELS.filter(([id]) => cls.models[id].curve).map(([id, label, color]) => (
          <span key={id} className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-3" style={{ backgroundColor: color }} />
            {label}
          </span>
        ))}
        <span>dashed: failure rate in the test period ({pct(prevalence)}), where a model with no skill sits</span>
      </div>
    </figure>
  );
}

export default function RealDataTab() {
  const [sensor, setSensor] = useState(spc.features[4].sensor);
  const feature = spc.features.find((f) => f.sensor === sensor);
  const w5 = bridge.windows[String(bridge.primary_window_runs)].after_baseline;
  const w0 = bridge.windows['0'].after_baseline;

  return (
    <div className="space-y-10">
      <section className="max-w-3xl space-y-3">
        <p className="text-[14px] leading-relaxed text-slate-400">
          Everything else on this site is synthetic. This tab runs the same ideas on <span className="text-slate-200">real,
          public data</span>: {d.runs.toLocaleString()} production runs from a semiconductor process, each with {d.sensors} anonymized
          sensor readings, a pass or fail label and a timestamp. Nothing was tuned on the test period, and every number is
          shown as it came out. <span className="text-slate-200">The honest result is modest: on this data the charts and models
          do not show a usable signal.</span> That is a finding, not a bug, and the reasons are below.
        </p>
        <p className="text-[12px] leading-relaxed text-slate-500">
          Source: {real.source.citation}. Licensed {real.source.license}. The raw files are not stored in this repository;{' '}
          <span className="font-mono">ml/real/download_secom.py</span> fetches them. The readings of the 8 charted sensors appear here
          as derived data, credited to the source.
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Runs', d.runs.toLocaleString(), `${d.first_run.slice(0, 10)} to ${d.last_run.slice(0, 10)}, about ${Math.round(d.runs_per_day)} a day`],
          ['Failures', `${d.failures} (${pct(d.fail_rate)})`, `by fifth of the timeline: ${d.failures_by_fifth_of_timeline.join(', ')}`],
          ['Sensors', d.sensors, `${d.sensors_constant} constant, ${d.sensors_over_50pct_missing} mostly missing`],
          ['Train / test', `${cls.train.runs} / ${cls.test.runs}`, `${cls.train.failures} / ${cls.test.failures} failures, split by time`],
        ].map(([label, value, note]) => (
          <div key={label} className="rounded border border-slate-800 bg-slate-900/40 px-4 py-3">
            <div className="text-[11px] tracking-wide text-slate-500 uppercase">{label}</div>
            <div className="mt-1 font-mono text-[20px] text-slate-100">{value}</div>
            <div className="mt-0.5 text-[11px] text-slate-500">{note}</div>
          </div>
        ))}
      </section>

      {/* SPC ------------------------------------------------------------------ */}
      <section className="space-y-3">
        <div>
          <h2 className="text-[14px] font-semibold text-slate-100">1. Statistical process control on real sensors</h2>
          <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-slate-500">
            {spc.selection}. Individuals charts: limits come from the first {spc.baseline_runs} runs and are then held fixed, and the
            Western Electric and Nelson rules are applied to every later run. Click a row to chart that sensor.
          </p>
        </div>
        <div className="overflow-x-auto rounded border border-slate-800">
          <table className="w-full text-[12px]">
            <thead className="bg-slate-900/60 text-[11px] tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Sensor</th>
                <th className="px-3 py-2 text-right font-medium">Signals in baseline</th>
                <th className="px-3 py-2 text-right font-medium">Signals after</th>
                <th className="px-3 py-2 text-right font-medium">Share of later runs</th>
                <th className="px-3 py-2 text-right font-medium">Spread vs limits</th>
                <th className="px-3 py-2 text-right font-medium">Mean shift (σ)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {spc.features.map((f) => (
                <tr key={f.sensor} onClick={() => setSensor(f.sensor)} className={`cursor-pointer ${f.sensor === sensor ? 'bg-slate-800/60' : 'hover:bg-slate-900/60'}`}>
                  <td className="px-3 py-1.5 font-mono text-slate-200">{f.sensor}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-400">{f.signals_in_baseline}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-400">{f.signals_post_baseline}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-amber-300">{pct(f.post_baseline_signal_rate)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-400">{f.post_sd_over_sigma.toFixed(2)}×</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-400">{f.post_mean_shift_in_sigma.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <SensorChart feature={feature} />
        <div className="max-w-3xl space-y-1.5 text-[12px] leading-relaxed text-slate-500">
          <div className="text-[11px] tracking-wide text-slate-500 uppercase">Reading this</div>
          <p>
            <span className="text-slate-300">These sensors are not stable processes, even inside the baseline.</span> All eight have
            signals inside the {spc.baseline_runs} runs used to set the limits ({Math.min(...spc.features.map((f) => f.signals_in_baseline))} to {Math.max(...spc.features.map((f) => f.signals_in_baseline))} each). After the baseline, the spread is up to{' '}
            {Math.max(...spc.features.map((f) => f.post_sd_over_sigma)).toFixed(1)}× what the limits assume, while the average barely
            moves (under {Math.ceil(Math.max(...spc.features.map((f) => Math.abs(f.post_mean_shift_in_sigma))) * 10) / 10}σ). Limits built from
            run-to-run differences are tight when neighbouring runs resemble each other, so the extra spread reads as constant
            out-of-control. The likely causes are autocorrelation and non-normal readings, which a plain individuals chart does not
            handle; I did not test that further.
          </p>
          <p>
            <span className="text-slate-300">Capability (Cpk, Ppk) is not reported.</span> {spc.capability.reason}
          </p>
        </div>
      </section>

      {/* Classification --------------------------------------------------------- */}
      <section className="space-y-3">
        <div>
          <h2 className="text-[14px] font-semibold text-slate-100">2. Predicting pass or fail from the sensors</h2>
          <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-slate-500">
            Failures are about {pct(d.fail_rate)} of runs, so accuracy would be meaningless: always guessing pass is {pct(1 - cls.test.fail_rate)} accurate.
            Scored instead on precision, recall and PR-AUC (average precision; a model with no skill scores about the test-period failure
            rate, {f3(cls.test.fail_rate)}). {cls.protocol.split}. Tuning: {cls.protocol.tuning}. Threshold: {cls.protocol.threshold}. The
            test period was used {cls.protocol.test_set_used}. PR-AUC intervals are 95% bootstrap intervals over the {cls.test.runs} test runs,
            which hold only {cls.test.failures} failures.
          </p>
        </div>
        <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <div className="overflow-x-auto rounded border border-slate-800">
            <table className="w-full text-[12px]">
              <thead className="bg-slate-900/60 text-[11px] tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Method</th>
                  <th className="px-3 py-2 text-right font-medium">PR-AUC</th>
                  <th className="px-3 py-2 text-right font-medium">95% interval</th>
                  <th className="px-3 py-2 text-right font-medium">Precision</th>
                  <th className="px-3 py-2 text-right font-medium">Recall</th>
                  <th className="px-3 py-2 text-right font-medium">TP / FP / FN</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {MODELS.map(([id, label]) => {
                  const m = cls.models[id];
                  const t = m.at_threshold;
                  return (
                    <tr key={id} className="text-slate-300">
                      <td className="px-3 py-1.5">{label}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-100">{f3(m.pr_auc)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-[11px] text-slate-500">{m.pr_auc_ci95 ? `${f3(m.pr_auc_ci95[0])}–${f3(m.pr_auc_ci95[1])}` : '—'}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">{t.precision === null ? 'n/a' : f3(t.precision)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">{t.recall === null ? 'n/a' : f3(t.recall)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-500">{t.tp} / {t.fp} / {t.fn}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="px-3 py-2 text-[11px] leading-relaxed text-slate-600">
              Rule baseline: {cls.models.control_chart_rule.rule} (sensors {cls.models.control_chart_rule.top_sensors.join(', ')}). Time-ordered cross-validation
              PR-AUC inside the training period was {f3(cls.models.decision_tree.cv_pr_auc_mean)} (tree), {f3(cls.models.random_forest.cv_pr_auc_mean)} (forest)
              and {f3(cls.models.logistic_regression.cv_pr_auc_mean)} (logistic), well above what they scored on the later test period.
            </p>
          </div>
          <PrChart />
        </div>
        <div className="max-w-3xl space-y-1.5 text-[12px] leading-relaxed text-slate-500">
          <div className="text-[11px] tracking-wide text-slate-500 uppercase">Reading this</div>
          <p>
            <span className="text-slate-300">No model clearly beats chance on the later runs.</span> The three models score PR-AUC {f3(cls.models.decision_tree.pr_auc)} to{' '}
            {f3(cls.models.random_forest.pr_auc)} against {f3(cls.models.majority_class.pr_auc)} for no skill, and every interval includes that floor.
            The forest, which scored best in cross-validation, caught none of the {cls.test.failures} test failures at its chosen threshold. Logistic regression caught
            {' '}{cls.models.logistic_regression.at_threshold.tp} of {cls.test.failures} but raised {cls.models.logistic_regression.at_threshold.fp} false alarms (precision {f3(cls.models.logistic_regression.at_threshold.precision)}).
            The control-chart rule flagged {cls.models.control_chart_rule.at_threshold.flagged_runs} runs and none were failures.
          </p>
          <p>
            Failures were concentrated early ({d.failures_by_fifth_of_timeline[0]} in the first fifth of the timeline against {d.failures_by_fifth_of_timeline.slice(1).join(', ')} in the rest), so the
            training period fails more often ({pct(cls.train.fail_rate)}) than the test period ({pct(cls.test.fail_rate)}) and the relationship between sensors and failure
            may not carry forward. A time split is the honest test of that, and here it says it does not.
          </p>
        </div>
      </section>

      {/* Bridge ------------------------------------------------------------------ */}
      <section className="space-y-3">
        <div>
          <h2 className="text-[14px] font-semibold text-slate-100">3. Bridge to the audit: signals before failures, and silent failures</h2>
          <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-slate-500">
            This is the real-data version of the audit's silent-miss idea: which failures did no control chart flag? {bridge.definition}.
            Only runs after the baseline are counted, since the baseline is where the limits were fitted.
          </p>
        </div>
        <div className="overflow-x-auto rounded border border-slate-800">
          <table className="w-full text-[12px]">
            <thead className="bg-slate-900/60 text-[11px] tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Look-back window</th>
                <th className="px-3 py-2 text-right font-medium">Failures flagged</th>
                <th className="px-3 py-2 text-right font-medium">Silent failures</th>
                <th className="px-3 py-2 text-right font-medium">Passing runs flagged</th>
                <th className="px-3 py-2 text-right font-medium">Lift</th>
                <th className="px-3 py-2 text-right font-medium">Fisher p</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {Object.entries(bridge.windows).map(([w, t]) => {
                const a = t.after_baseline;
                return (
                  <tr key={w} className={`text-slate-300 ${Number(w) === bridge.primary_window_runs ? 'bg-slate-800/40' : ''}`}>
                    <td className="px-3 py-1.5">{w === '0' ? 'that run only' : `that run + ${w} before`}{Number(w) === bridge.primary_window_runs ? ' (declared in advance)' : ''}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{a.failures_flagged} / {a.failures} ({pct(a.share_failures_flagged)})</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-amber-300">{a.failures_silent}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{pct(a.share_passes_flagged)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-400">{a.lift}×</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-500">{a.fisher_p}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="max-w-3xl space-y-1.5 text-[12px] leading-relaxed text-slate-500">
          <div className="text-[11px] tracking-wide text-slate-500 uppercase">Reading this</div>
          <p>
            <span className="text-slate-300">Only {w5.failures_silent} of {w5.failures} failures went unflagged, but that is not a win.</span> The charts flag{' '}
            {pct(w5.share_passes_flagged)} of passing runs too, so a flag says almost nothing about failure (lift {w5.lift}×, with the passing runs slightly more
            likely to be flagged). With a longer look-back everything is flagged. Even on the strictest reading, a signal at the failing run itself,{' '}
            {pct(w0.share_failures_flagged)} of failures are flagged against {pct(w0.share_passes_flagged)} of passing runs. These charts, as built, do not separate failures from passes.
          </p>
          <p>
            By sensor, a signal at the run itself was equally or less common on failures than on passes for 7 of the 8. Sensor 23 is the exception (13.3% of failures
            against 6.6% of passes, p = 0.06), which is not significant once you allow for checking 8 sensors.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="overflow-x-auto rounded border border-slate-800">
            <table className="w-full text-[12px]">
              <thead className="bg-slate-900/60 text-[11px] tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Sensor</th>
                  <th className="px-3 py-2 text-right font-medium">Signal on failing runs</th>
                  <th className="px-3 py-2 text-right font-medium">Signal on passing runs</th>
                  <th className="px-3 py-2 text-right font-medium">p</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {bridge.per_sensor_at_run.map((s) => (
                  <tr key={s.sensor} className="text-slate-300">
                    <td className="px-3 py-1.5 font-mono">{s.sensor}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{pct(s.share_failures_with_signal_at_run)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{pct(s.share_passes_with_signal_at_run)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-500">{s.fisher_p}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto rounded border border-slate-800">
            <table className="w-full text-[12px]">
              <thead className="bg-slate-900/60 text-[11px] tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Failing run</th>
                  <th className="px-3 py-2 text-left font-medium">Last signal</th>
                  <th className="px-3 py-2 text-left font-medium">Sensors / rules</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {bridge.flagged_examples.slice(0, 8).map((e) => (
                  <tr key={e.run} className="text-slate-300">
                    <td className="px-3 py-1.5 font-mono text-[11px]">#{e.run} {when(e.time)}</td>
                    <td className="px-3 py-1.5 text-slate-400">{e.runs_before === 0 ? 'at the run' : `${e.runs_before} run${e.runs_before > 1 ? 's' : ''} before`}</td>
                    <td className="px-3 py-1.5 font-mono text-[11px] text-slate-400">{e.sensors.join(', ')} · {e.rules.join(', ')}</td>
                  </tr>
                ))}
                {bridge.silent_failures.map((e) => (
                  <tr key={e.run} className="text-slate-300">
                    <td className="px-3 py-1.5 font-mono text-[11px]">#{e.run} {when(e.time)}</td>
                    <td className="px-3 py-1.5 text-amber-300" colSpan={2}>silent: no signal at the run or the {bridge.primary_window_runs} before it</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-3 py-2 text-[11px] text-slate-600">The first 8 flagged failures after the baseline, then every silent one.</p>
          </div>
        </div>
      </section>

      {/* Limits ------------------------------------------------------------------ */}
      <section className="max-w-3xl text-[12px] leading-relaxed text-slate-500">
        <h2 className="text-[13px] font-semibold text-slate-200">Limitations</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>The sensors are anonymized, so there is no way to say what any of them measures, and the dataset publishes no specification limits, so capability cannot be computed honestly.</li>
          <li>There are only {d.failures} failures, {cls.test.failures} of them in the test period. Intervals on every metric are wide, and a different split could rank the models differently.</li>
          <li>The process was not stable over the {d.days} days, so limits from an early baseline and a model trained on early runs both age badly. That is realistic, and it is why the time split matters.</li>
          <li>One baseline length ({spc.baseline_runs} runs), one look-back window (declared in advance, with three others shown for sensitivity) and one split were used. None was tuned.</li>
          <li>A plain individuals chart assumes roughly independent, normal readings. These readings are neither, and I did not try to correct for that.</li>
        </ul>
      </section>
    </div>
  );
}
