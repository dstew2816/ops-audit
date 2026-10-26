// The home page: the problem, how the audit works, and what it found, written as prose.
// Every number in the text is computed or read from the same source as the tab it
// points to, so this page cannot drift from the detail.

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

const P = 'text-[15px] leading-[1.75] text-slate-300';

function TabLink({ tab, onNavigate, children }) {
  return (
    <button
      type="button"
      onClick={() => onNavigate(tab)}
      className="text-slate-100 underline decoration-slate-600 underline-offset-4 hover:decoration-slate-300"
    >
      {children}
    </button>
  );
}

function Box({ title, children }) {
  return (
    <div className="rounded border border-slate-800 bg-slate-900/40 px-4 py-3">
      <div className="text-[13px] font-medium text-slate-200">{title}</div>
      <div className="mt-0.5 text-[12px] leading-relaxed text-slate-500">{children}</div>
    </div>
  );
}

const Arrow = () => (
  <div className="text-center text-slate-600 select-none" aria-hidden="true">
    <span className="md:hidden">&darr;</span>
    <span className="hidden md:inline">&rarr;</span>
  </div>
);

function AuditDiagram() {
  return (
    <figure>
      <div className="grid items-center gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
        <div className="space-y-3">
          <Box title="Raw events">What actually happened: states, timestamps, readings.</Box>
          <Box title="The automation&rsquo;s own log">What the procedure says it did.</Box>
        </div>
        <Arrow />
        <Box title="Audit">Rebuild the cases that should have triggered each procedure, then look for them in its log. A case with no log entry is a silent miss.</Box>
        <Arrow />
        <div className="space-y-3">
          <Box title="Impact model">Labor hours and cost at risk, with the fixes ranked.</Box>
          <Box title="Root-cause grouping">Which misses share a cause, and what it is.</Box>
        </div>
      </div>
      <figcaption className="mt-2 text-[12px] leading-relaxed text-slate-500">
        Two independent sources go in, and the audit does not rely on the automation&rsquo;s log to say what it missed, since
        the missed cases are the ones that never reached it.
      </figcaption>
    </figure>
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
      cpk: b.capability.cpk,
      ppk: b.capability.ppk,
    };
  }, []);

  const cov = live?.coverage;
  const imp = live?.impact;
  const top = imp ? rankQueue(imp.queue, 'total')[0] : null;

  const m = ml.test_metrics;
  const resolved = generation?.entries.filter(
    (e) => e.stages?.find((s) => s.stage === 'resolve')?.value?.asopId === e.expectedAsop,
  ).length;
  const exact = generation?.entries.filter((e) => e.ok).length;
  const diagPassed = diagnosis
    ? ['coverage', 'outage', 'trap', 'coincidental', 'standAlone'].filter((k) => diagnosis.score.dimensions?.[k]?.ok).length
    : null;

  const bridge = real.bridge.windows[String(real.bridge.primary_window_runs)].after_baseline;
  const models = real.classification.models;

  return (
    <div className="max-w-3xl space-y-8">
      <section className="space-y-4">
        <p className="text-[17px] leading-[1.7] text-slate-100">
          Automated procedures can fail without anyone noticing, because the platform that runs them has no way to see the
          cases it never picked up. A procedure that watches for a conveyor stopped for thirty minutes, or for stock below
          its reorder point, runs on live events and cannot replay history, so if the platform is down for a few hours or
          an event arrives late, the case is lost and nothing records that it was missed.
        </p>
        <p className={P}>
          OpsAudit goes back to the raw history, works out which cases should have triggered each procedure, and compares
          that list with what the procedure actually logged. The difference between the two is the set of silent misses.
          From there it estimates what the misses cost, groups them by cause and ranks the fixes. This is a demo of the kind
          of work I did at TSMC, and everything in it is synthetic data apart from one stress test on a public dataset.
        </p>
      </section>

      <AuditDiagram />

      <section className="space-y-4">
        <h2 className="text-[13px] font-semibold tracking-wide text-slate-400 uppercase">What I found</h2>
        <p className={P}>
          Across seven procedures and 14 days of synthetic history,{' '}
          {cov ? `${cov.qualifying} cases qualified for action, ${cov.logged} were logged by the automation and ${cov.missed} were not, which is ${pct(cov.missed / cov.qualifying)}` : 'the audit is loading'}.
          {imp && top
            ? ` Under deliberately low assumptions that you can edit, those misses come to about ${imp.totals.hours.toFixed(1)} labor hours and ${money(imp.totals.total)} at risk, and one fix, a backfill after the platform outage, covers ${top.misses} of the ${imp.totals.misses} misses and about ${Math.round((top.total / imp.totals.total) * 100)}% of the cost. The dollar figures come from assumptions I chose.`
            : ''}{' '}
          The <TabLink tab="audit" onNavigate={onNavigate}>Audit tab</TabLink> shows the query behind each count, and
          the <TabLink tab="impact" onNavigate={onNavigate}>Impact tab</TabLink> lets you change the assumptions.
        </p>

        <p className={P}>
          The stations that batches pass through are monitored with statistical process control (SPC), which uses control
          charts to tell ordinary variation from a real change. I planted a slow drift in one of two parallel stations that
          should behave alike. The chart below shows that station&rsquo;s average cycle time, with limits set from an early
          baseline and then held fixed, and its first alert comes {spc.firstAlert - DRIFT_START} subgroups after the
          drift starts. A chart of the gap between the two stations catches it later, at subgroup {spc.pairAlert}. The
          station&rsquo;s process capability index (Cpk) is {spc.cpk.toFixed(2)} while its process performance index (Ppk) is{' '}
          {spc.ppk.toFixed(2)}, which means it is capable while stable but did not stay stable. More is on the{' '}
          <TabLink tab="spc" onNavigate={onNavigate}>SPC tab</TabLink>.
        </p>

        <ControlChart
          title="Planted drift: station ST-3B, average cycle time per subgroup of five (minutes)"
          values={spc.analysis.chart.means}
          {...spc.analysis.chart.xbar}
          hits={spc.analysis.xbarHits}
          baseline={BASELINE}
          labels={spc.analysis.groups.map((g) => `Subgroup ${g.subgroup}`)}
        />

        <p className={P}>
          Procedure definitions in a real organization are messy, with names in several languages, missing fields and
          thresholds in mixed units. I trained a classifier (machine learning, or ML) on {ml.dataset.n.toLocaleString()} synthetic
          definitions like that. On {ml.dataset.n_test} held-out definitions the decision tree names which of{' '}
          {ml.dataset.n_leaves} kinds of check a procedure is {pct(m.decision_tree.leaf_accuracy)} of the time, against{' '}
          {pct(m.rules_en.leaf_accuracy)} to {pct(m.rules_multi.leaf_accuracy)} for the hand-written rules I froze before
          training. It does much worse on vague definitions, where there is little text to go on
          ({pct(m.decision_tree.by_slice.record_quality.vague.accuracy)}). The{' '}
          <TabLink tab="ml" onNavigate={onNavigate}>ML tab</TabLink> has the confusion matrix and the check that no single
          feature gives the answer away.
        </p>

        <p className={P}>
          Two language-model layers sit on top of the audit. One writes the detection query from a process document, in three
          separate calls so that a failure can be traced to a step; in the run I recorded
          {generation ? ` it identified the right procedure for ${resolved} of ${generation.entries.length} documents and matched the hand-written query exactly on ${exact}` : ' it is not yet recorded'}.
          The other groups the misses by root cause{diagnosis ? ` and passed ${diagPassed} of its 5 checks: it recovered the outage cluster exactly and also made two of the mistakes the data was built to provoke` : ''}.
          Both are single runs, so a second run could score differently. The{' '}
          <TabLink tab="ai" onNavigate={onNavigate}>AI Layers tab</TabLink> shows each failure and the step where it started.
        </p>

        <p className={P}>
          I also stress-tested the SPC and classification methods on a public dataset, the SECOM data from the University of
          California, Irvine (UCI) Machine Learning Repository: {real.dataset.runs.toLocaleString()} production runs from a
          semiconductor process, each with {real.dataset.sensors} anonymized sensor readings. The result was weak. With
          control limits set from an early baseline, {pct(bridge.share_failures_flagged)} of failing runs were flagged, but so were{' '}
          {pct(bridge.share_passes_flagged)} of passing runs, so a flag says almost nothing about whether a run fails. On the
          later runs no classifier clearly beat chance: the area under the precision-recall curve (PR-AUC) was{' '}
          {models.decision_tree.pr_auc.toFixed(2)} to {models.random_forest.pr_auc.toFixed(2)} against{' '}
          {models.majority_class.pr_auc.toFixed(3)} for a model with no skill, and the test period holds only{' '}
          {real.classification.test.failures} failures. The likely causes are a process that was not stable and charts that
          assume independent, normally distributed readings, but I did not test those explanations. The{' '}
          <TabLink tab="real" onNavigate={onNavigate}>Real Data tab</TabLink> has the charts and the full table.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-[13px] font-semibold tracking-wide text-slate-400 uppercase">Limits</h2>
        <p className={P}>
          I built the synthetic data and wrote the answer keys, so the classifier&rsquo;s accuracy probably overstates what
          real documents would give, and every sample here is small. The{' '}
          <a className="text-slate-100 underline decoration-slate-600 underline-offset-4 hover:decoration-slate-300" href={`${REPO}#readme`} target="_blank" rel="noreferrer">
            write-up on GitHub
          </a>{' '}
          lists the limits in full, and the{' '}
          <a className="text-slate-100 underline decoration-slate-600 underline-offset-4 hover:decoration-slate-300" href={REPO} target="_blank" rel="noreferrer">
            code
          </a>{' '}
          is there too.
        </p>
      </section>
    </div>
  );
}
