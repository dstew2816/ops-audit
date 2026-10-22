// The landing page. Every headline number is computed or read from the same
// source the tab it links to uses, so this page cannot drift from the detail.

import { useEffect, useMemo, useState } from 'react';
import { loadDatabase } from '../db/client.js';
import { EXPECTED_FINDINGS } from '../db/expected-findings.js';
import { SEED_ROWS } from '../db/seed/index.js';
import { loadCoverage, loadMissRecords } from '../impact/misses.js';
import { DEFAULT_ASSUMPTIONS, estimateImpact } from '../impact/impact.js';
import { BASELINE, analyzeStation } from '../spc/spc.js';
import { DRIFT_START } from '../db/seed/measurements.js';
import ml from '../../ml/results/results.json';
import real from '../../ml/real/results/secom_results.json';

const ai = import.meta.glob('../ai/results/*.json', { eager: true, import: 'default' });
const generation = ai['../ai/results/generation.json'] ?? null;
const diagnosis = ai['../ai/results/diagnosis.json'] ?? null;

const REPO = 'https://github.com/dstew2816/ops-audit';
const TAB_NAMES = { audit: 'Audit', impact: 'Impact', spc: 'SPC', ml: 'ML', real: 'Real Data', ai: 'AI Layers' };
const pct = (v, d = 1) => `${(v * 100).toFixed(d)}%`;
const money = (v) => `$${Math.round(v).toLocaleString()}`;

function Card({ label, value, line, detail, tab, onNavigate }) {
  return (
    <button
      type="button"
      onClick={() => onNavigate(tab)}
      className="group rounded border border-slate-800 bg-slate-900/40 p-4 text-left transition-colors hover:border-sky-500/50 hover:bg-slate-900/70"
    >
      <div className="text-[11px] tracking-wide text-slate-500 uppercase">{label}</div>
      <div className="mt-1 font-mono text-[28px] leading-tight text-slate-100">{value}</div>
      <div className="mt-1 text-[13px] text-slate-300">{line}</div>
      <div className="mt-1 text-[12px] leading-relaxed text-slate-500">{detail}</div>
      <div className="mt-3 text-[12px] text-sky-400 group-hover:underline">{TAB_NAMES[tab]} tab &rarr;</div>
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
    const spec = SEED_ROWS.station_specs.find((s) => s.station_id === 'ST-3B');
    const rows = SEED_ROWS.station_measurements.filter((r) => r.station_id === 'ST-3B');
    const a = analyzeStation(rows, spec);
    return { firstAlert: a.xbarHits[0]?.index, cpk: a.capability.cpk, ppk: a.capability.ppk };
  }, []);

  const exact = generation?.entries.filter((e) => e.ok).length;
  const resolved = generation?.entries.filter(
    (e) => e.stages?.find((s) => s.stage === 'resolve')?.value?.asopId === e.expectedAsop,
  ).length;
  const diagPassed = diagnosis
    ? ['coverage', 'outage', 'trap', 'coincidental', 'standAlone'].filter((k) => diagnosis.score.dimensions?.[k]?.ok).length
    : null;

  const cov = live?.coverage;
  const imp = live?.impact.totals;

  return (
    <div className="space-y-10">
      <section className="max-w-3xl">
        <p className="text-[20px] leading-snug font-medium text-slate-100">
          Automated procedures can report a 100% success rate, because nobody counts the cases they never picked up.
        </p>
        <p className="mt-3 text-[14px] leading-relaxed text-slate-400">
          OpsAudit rebuilds what each procedure <em>should</em> have caught from raw history, compares it with what it
          actually did, and puts a price and a priority on the gap. It adds process-control charts for the stations
          involved, a machine-learning classifier, and two language-model layers, each graded against answers I wrote
          by hand.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-[12px]">
          <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-200">
            Synthetic data, plus one public real-data check
          </span>
          <a className="text-sky-400 hover:underline" href={REPO} target="_blank" rel="noreferrer">
            Code on GitHub
          </a>
          <a className="text-sky-400 hover:underline" href={`${REPO}#readme`} target="_blank" rel="noreferrer">
            Read the write-up
          </a>
        </div>
      </section>

      <section>
        <h2 className="text-[13px] font-semibold text-slate-200">What it found</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card
            label="Audit"
            value={cov ? pct(cov.missed / cov.qualifying) : '…'}
            line={cov ? `${cov.missed} of ${cov.qualifying} cases never picked up` : 'Loading'}
            detail="Seven procedures, rebuilt from raw history and checked against what each one logged."
            tab="audit"
            onNavigate={onNavigate}
          />
          <Card
            label="Cost at risk"
            value={imp ? money(imp.total) : '…'}
            line={imp ? `${imp.hours.toFixed(1)} labor hours in 14 days` : 'Loading'}
            detail="Under low, editable assumptions. A ranked queue says which fix to do first."
            tab="impact"
            onNavigate={onNavigate}
          />
          <Card
            label="Process control"
            value={`${spc.firstAlert - DRIFT_START} subgroups`}
            line="from the start of a drift to its alarm"
            detail={`Cpk ${spc.cpk.toFixed(2)} but Ppk ${spc.ppk.toFixed(2)}: capable when stable, did not stay stable. Limits set from the first ${BASELINE} subgroups.`}
            tab="spc"
            onNavigate={onNavigate}
          />
          <Card
            label="Machine learning"
            value={pct(ml.test_metrics.decision_tree.leaf_accuracy)}
            line={`vs ${pct(ml.test_metrics.rules_en.leaf_accuracy)} for hand-written rules`}
            detail={`Decision tree naming which of ${ml.dataset.n_leaves} checks a procedure is, on ${ml.dataset.n_test} held-out records. ${pct(ml.test_metrics.decision_tree.kind_accuracy)} on the kind of check.`}
            tab="ml"
            onNavigate={onNavigate}
          />
          <Card
            label="Real data (public)"
            value={`${pct(real.bridge.windows[String(real.bridge.primary_window_runs)].after_baseline.share_failures_flagged, 0)} vs ${pct(real.bridge.windows[String(real.bridge.primary_window_runs)].after_baseline.share_passes_flagged, 0)}`}
            line="of failing vs passing runs flagged by control charts"
            detail={`On ${real.dataset.runs.toLocaleString()} real runs, the charts and models do not beat chance (PR-AUC ${real.classification.models.random_forest.pr_auc.toFixed(2)} vs ${real.classification.models.majority_class.pr_auc.toFixed(2)} for no skill). Reported as found.`}
            tab="real"
            onNavigate={onNavigate}
          />
          <Card
            label="AI: documents to logic"
            value={generation ? `${resolved}/${generation.entries.length}` : '…'}
            line={generation ? `procedures resolved; ${exact} matched the baseline exactly` : 'Not recorded'}
            detail="One live run per document. The failures are shown, with where in the chain each one started."
            tab="ai"
            onNavigate={onNavigate}
          />
          <Card
            label="AI: root causes"
            value={diagnosis ? `${diagPassed}/5` : '…'}
            line={diagnosis ? 'checks passed on 24 misses' : 'Not recorded'}
            detail="Recovered the outage cluster exactly, then fell for two of the traps built into the data."
            tab="ai"
            onNavigate={onNavigate}
          />
        </div>
      </section>

      <section className="max-w-3xl">
        <h2 className="text-[13px] font-semibold text-slate-200">How to read it</h2>
        <ol className="mt-3 space-y-2 text-[13px] leading-relaxed text-slate-400">
          <li><span className="text-slate-200">Audit.</span> What was missed, per procedure, with the query behind each number.</li>
          <li><span className="text-slate-200">Network.</span> The seven-station route the batches take, and where they wait.</li>
          <li><span className="text-slate-200">SPC.</span> Control charts, capability and alerts for each station, plus drift between two parallel lanes.</li>
          <li><span className="text-slate-200">Impact.</span> Hours and dollars at risk, with every assumption editable, and the fix queue.</li>
          <li><span className="text-slate-200">ML.</span> A learned classifier against hand-written rules, side by side.</li>
          <li><span className="text-slate-200">AI Layers.</span> Two language-model layers, graded honestly, failures included.</li>
        </ol>
        <p className="mt-4 text-[12px] leading-relaxed text-slate-600">
          Small sample, one run of each AI layer, and answer keys I wrote myself, so treat the numbers as a demonstration
          of method rather than a benchmark. The limits are spelled out in the write-up.
        </p>
      </section>
    </div>
  );
}
