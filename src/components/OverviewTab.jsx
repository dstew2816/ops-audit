// The front page. Everything a reader needs is here: what the project is, the headline
// results, the fix queue, the drift chart and the stack. The other views hold the detail.
// Every number is computed or read from the same source as the view it points to,
// so this page cannot drift from the detail.

import { useEffect, useMemo, useState } from 'react';
import { loadDatabase } from '../db/client.js';
import { EXPECTED_FINDINGS } from '../db/expected-findings.js';
import { SEED_ROWS } from '../db/seed/index.js';
import { loadCoverage, loadMissRecords } from '../impact/misses.js';
import { DEFAULT_ASSUMPTIONS, estimateImpact, rankQueue } from '../impact/impact.js';
import { BASELINE, analyzeStation, pairDrift } from '../spc/spc.js';
import { DRIFT_START } from '../db/seed/measurements.js';
import ControlChart from './ControlChart.jsx';
import ml from '../../ml/results/results.json';
import real from '../../ml/real/results/secom_results.json';

const ai = import.meta.glob('../ai/results/*.json', { eager: true, import: 'default' });
const generation = ai['../ai/results/generation.json'] ?? null;
const diagnosis = ai['../ai/results/diagnosis.json'] ?? null;

const REPO = 'https://github.com/dstew2816/ops-audit';
const pct = (v, d = 1) => `${(v * 100).toFixed(d)}%`;
const money = (v) => `$${Math.round(v).toLocaleString()}`;

const H2 = 'text-[18px] font-semibold tracking-tight text-slate-100';
const B = ({ children }) => <strong className="font-semibold text-slate-100">{children}</strong>;

function Kpi({ value, label, detail }) {
  return (
    <div className="rounded-[14px] border border-slate-800 bg-slate-900 p-4">
      <div className="font-mono text-[1.7rem] leading-tight font-medium whitespace-nowrap text-slate-100">{value}</div>
      <div className="mt-1 text-[13px] font-medium text-slate-200">{label}</div>
      <div className="mt-0.5 text-[12px] leading-snug text-slate-500">{detail}</div>
    </div>
  );
}

function Step({ n, title, children }) {
  return (
    <div className="rounded-[14px] border border-slate-800 bg-slate-900 p-4">
      <div className="eyebrow">Step {n}</div>
      <div className="mt-1 text-[14px] font-semibold text-slate-100">{title}</div>
      <p className="mt-1 text-[13px] leading-relaxed text-slate-500">{children}</p>
    </div>
  );
}

function GoCard({ title, children, to, onNavigate }) {
  return (
    <button
      type="button"
      onClick={() => onNavigate(to)}
      className="rounded-[14px] border border-slate-800 bg-slate-900 p-4 text-left transition-colors hover:border-slate-700"
    >
      <div className="flex items-baseline justify-between">
        <span className="text-[14px] font-semibold text-slate-100">{title}</span>
        <span className="text-slate-500" aria-hidden="true">&rarr;</span>
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-slate-500">{children}</p>
    </button>
  );
}

export default function OverviewTab({ onNavigate }) {
  const [live, setLive] = useState(null);

  useEffect(() => {
    let cancelled = false;
    loadDatabase()
      .then((db) => {
        const coverage = loadCoverage(db);
        const impact = estimateImpact(loadMissRecords(db), EXPECTED_FINDINGS, DEFAULT_ASSUMPTIONS);
        if (!cancelled) setLive({ coverage, impact });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const spc = useMemo(() => {
    const run = (id) =>
      analyzeStation(
        SEED_ROWS.station_measurements.filter((r) => r.station_id === id),
        SEED_ROWS.station_specs.find((s) => s.station_id === id),
      );
    const a = run('ST-3A');
    const b = run('ST-3B');
    return {
      analysis: b,
      firstAlert: b.xbarHits[0]?.index,
      pairAlert: pairDrift(a.chart.means, b.chart.means).firstAlert,
    };
  }, []);

  const cov = live?.coverage;
  const imp = live?.impact;
  const queue = imp ? rankQueue(imp.queue, 'total') : [];
  const top = queue[0];

  const m = ml.test_metrics;
  const resolved = generation?.entries.filter(
    (e) => e.stages?.find((s) => s.stage === 'resolve')?.value?.asopId === e.expectedAsop,
  ).length;
  const bridge = real.bridge.windows[String(real.bridge.primary_window_runs)].after_baseline;
  const models = real.classification.models;

  return (
    <div className="space-y-12">
      {/* Headline ------------------------------------------------------------- */}
      <section className="max-w-3xl">
        <h1 className="text-[clamp(2rem,5vw,3rem)] leading-[1.08] font-semibold tracking-tight text-slate-100">
          Finding what operations automation silently misses
        </h1>
        <p className="mt-4 text-[17px] leading-[1.7] text-slate-300">
          OpsAudit is a rebuild of the audit I led at <B>TSMC</B>. It works out from raw history which cases{' '}
          <B>should have</B> triggered each automated procedure, compares that with what the procedure actually logged,
          and <B>prices the gap</B>. The result is a ranked list of fixes a manager can act on.
        </p>
        <p className="mt-3 text-[15px] leading-[1.7] text-slate-400">
          Built with <B>SQL (SQLite)</B>, <B>Python and scikit-learn</B>, <B>statistical process control</B>,{' '}
          <B>React</B> and an <B>LLM layer</B>, with checks that run in CI.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <a
            href={REPO}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-slate-100 bg-slate-100 px-5 py-2.5 text-[14px] font-medium text-slate-950 hover:opacity-90"
          >
            Source on GitHub
          </a>
          <a
            href="https://dstew2816.github.io/projects/opsaudit.html"
            className="rounded-full border border-slate-700 px-5 py-2.5 text-[14px] font-medium text-slate-100 hover:border-slate-100"
          >
            Case study
          </a>
        </div>
      </section>

      {/* Results -------------------------------------------------------------- */}
      <section>
        <p className="eyebrow mb-3">Results</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            value={cov ? pct(cov.missed / cov.qualifying) : '...'}
            label="of cases silently missed"
            detail={cov ? `${cov.missed} of ${cov.qualifying} qualifying cases never picked up, across 7 procedures in 14 days` : 'Loading the audit'}
          />
          <Kpi
            value={imp ? money(imp.totals.total) : '...'}
            label="cost at risk"
            detail={imp ? `${imp.totals.hours.toFixed(1)} labor hours over 14 days, from editable assumptions` : 'Loading'}
          />
          <Kpi
            value={pct(m.random_forest.leaf_accuracy)}
            label="classifier accuracy"
            detail={`Random forest naming one of ${ml.dataset.n_leaves} kinds of check, versus ${pct(m.rules_multi.leaf_accuracy)} for hand-written rules, on ${ml.dataset.n_test} held-out records`}
          />
          <Kpi
            value={`Subgroup ${spc.firstAlert}`}
            label="drift caught"
            detail={`A planted drift started at subgroup ${DRIFT_START}. Control limits were fixed from an early baseline.`}
          />
        </div>
      </section>

      {/* How it works --------------------------------------------------------- */}
      <section>
        <h2 className={H2}>How it works</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <Step n="1" title="Rebuild what should have run">
            SQL over the <B>raw events</B> works out every case that should have triggered a procedure.
          </Step>
          <Step n="2" title="Compare with the log">
            A case with no entry in the automation&rsquo;s own log is a <B>silent miss</B>. The audit does not rely on that log to say what it missed.
          </Step>
          <Step n="3" title="Price and rank">
            Each miss becomes <B>labor hours and cost at risk</B>, grouped by cause into fixes and ranked.
          </Step>
        </div>
      </section>

      {/* Fix queue ------------------------------------------------------------ */}
      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className={H2}>The fix queue</h2>
          <button type="button" onClick={() => onNavigate('impact')} className="text-[13px] text-slate-400 underline decoration-slate-700 underline-offset-4 hover:text-slate-100">
            Change the assumptions
          </button>
        </div>
        <p className="mt-2 max-w-3xl text-[14px] leading-[1.7] text-slate-400">
          {imp && top ? (
            <>
              The largest fix, <B>{top.title.toLowerCase()}</B>, covers <B>{top.misses} of the {imp.totals.misses} misses</B> and about{' '}
              <B>{Math.round((top.total / imp.totals.total) * 100)}%</B> of the cost at risk.
            </>
          ) : (
            'Loading the audit.'
          )}
        </p>
        <div className="mt-3 overflow-x-auto rounded-[14px] border border-slate-800 bg-slate-900">
          <table className="w-full text-[13px]">
            <thead className="text-[11px] tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Fix</th>
                <th className="px-4 py-2.5 text-right font-medium">Misses</th>
                <th className="px-4 py-2.5 text-right font-medium">Hours</th>
                <th className="px-4 py-2.5 text-right font-medium">Cost at risk</th>
                <th className="px-4 py-2.5 text-right font-medium">Payback (wk)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {queue.slice(0, 5).map((q) => (
                <tr key={q.key} className="text-slate-300">
                  <td className="px-4 py-2">{q.title}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-400">{q.misses}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-400">{q.hours.toFixed(1)}</td>
                  <td className="px-4 py-2 text-right font-mono text-amber-300">{money(q.total)}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-400">{Number.isFinite(q.paybackWeeks) ? q.paybackWeeks.toFixed(1) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Monitoring ----------------------------------------------------------- */}
      <section className="max-w-3xl space-y-3">
        <h2 className={H2}>Catching drift with control charts</h2>
        <p className="text-[15px] leading-[1.7] text-slate-300">
          I planted a slow drift in one of two parallel stations. With limits set from an early baseline and then held fixed,
          the chart alerts <B>{spc.firstAlert - DRIFT_START} subgroups</B> after the drift starts, and a chart on the gap
          between the two stations catches it at subgroup {spc.pairAlert}.
        </p>
        <ControlChart
          title="Planted drift: station ST-3B, average cycle time per subgroup of five (minutes)"
          values={spc.analysis.chart.means}
          {...spc.analysis.chart.xbar}
          hits={spc.analysis.xbarHits}
          baseline={BASELINE}
          labels={spc.analysis.groups.map((g) => `Subgroup ${g.subgroup}`)}
        />
      </section>

      {/* Go deeper ------------------------------------------------------------ */}
      <section>
        <h2 className={H2}>Go deeper</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <GoCard title="Audit and cost" to="audit" onNavigate={onNavigate}>
            The query behind every count, the editable cost model, and the station network the batches move through.
          </GoCard>
          <GoCard title="Monitoring and models" to="models" onNavigate={onNavigate}>
            Control charts and process capability, the classifier with its confusion matrix, and two LLM layers with each failure shown.
          </GoCard>
          <GoCard title="Real-data check" to="real" onNavigate={onNavigate}>
            The same methods on a public semiconductor dataset, with the full results.
          </GoCard>
        </div>
      </section>

      {/* Limits, last --------------------------------------------------------- */}
      <section className="max-w-3xl space-y-3">
        <h2 className={H2}>Limits</h2>
        <p className="text-[14px] leading-[1.7] text-slate-400">
          Everything above runs on <B>synthetic data</B> that I built, with answer keys I wrote, so the classifier&rsquo;s
          accuracy probably overstates what real documents would give, and every sample is small. The dollar figures come
          from assumptions I chose. The two LLM layers were each run once: the first identified the right procedure for{' '}
          {resolved} of {generation?.entries.length} documents, and the second recovered the outage cluster but also made
          two of the mistakes the data was built to provoke.
        </p>
        <p className="text-[14px] leading-[1.7] text-slate-400">
          On the public SECOM semiconductor dataset ({real.dataset.runs.toLocaleString()} production runs) the method did not
          hold up. {pct(bridge.share_failures_flagged)} of failing runs were flagged, but so were {pct(bridge.share_passes_flagged)} of
          passing runs, and no classifier clearly beat chance (PR-AUC {models.decision_tree.pr_auc.toFixed(2)} to{' '}
          {models.random_forest.pr_auc.toFixed(2)} against {models.majority_class.pr_auc.toFixed(3)} for no skill). The{' '}
          <button type="button" onClick={() => onNavigate('real')} className="text-slate-100 underline decoration-slate-600 underline-offset-4">
            real-data view
          </button>{' '}
          has the full table, and the{' '}
          <a className="text-slate-100 underline decoration-slate-600 underline-offset-4" href={`${REPO}#readme`} target="_blank" rel="noreferrer">
            README
          </a>{' '}
          lists the limits in full.
        </p>
      </section>
    </div>
  );
}
