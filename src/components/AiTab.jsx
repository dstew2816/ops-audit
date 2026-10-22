// The two AI layers, with their live results graded against hand-written
// baselines. The page only DISPLAYS saved results; the model calls happen in
// Node (`npm run gen:check -- --save`, `npm run diag:check -- --save`), so the
// browser never holds an API key. Results files are optional: without them the
// tab says nothing has been recorded rather than inventing numbers.

import { useState } from 'react';
import { BASELINES } from '../db/baselines.js';
import { EXPECTED_FINDINGS } from '../db/expected-findings.js';

const files = import.meta.glob('../ai/results/*.json', { eager: true, import: 'default' });
const generation = files['../ai/results/generation.json'] ?? null;
const diagnosis = files['../ai/results/diagnosis.json'] ?? null;

const DIAG_DIMENSIONS = [
  ['coverage', 'Every miss lands in exactly one finding'],
  ['outage', 'Recovers the outage cluster: 8 misses, one infrastructure cause'],
  ['trap', 'Does not blame the outage for the 4 misses it cannot explain'],
  ['coincidental', 'Keeps the 3 coincidental misses as separate findings'],
  ['standAlone', 'Leaves the 2 unexplained misses alone'],
];

const Pill = ({ ok, children }) => (
  <span className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${ok ? 'bg-emerald-500/10 text-emerald-300' : 'bg-rose-500/10 text-rose-300'}`}>
    {children}
  </span>
);

const NotRecorded = ({ command }) => (
  <div className="rounded border border-dashed border-slate-700 px-4 py-6 text-[13px] text-slate-500">
    No live results recorded yet. Run{' '}
    <code className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[12px] text-slate-300">{command}</code> with an API
    key in the environment to record them here.
  </div>
);

const formatDate = (iso) => new Date(iso).toISOString().slice(0, 10);

function GenerationRow({ entry }) {
  const [open, setOpen] = useState(false);
  const s = entry.score;
  const resolved =
    s?.resolution?.checks?.find((c) => c.label === 'asopId')?.actual ??
    entry.stages?.find((st) => st.stage === 'resolve')?.value?.asopId ??
    '—';
  const resolvedOk = resolved === entry.expectedAsop;
  return (
    <>
      <tr onClick={() => setOpen(!open)} className="cursor-pointer text-slate-300 hover:bg-slate-900/60">
        <td className="px-3 py-2">
          <div className="text-slate-200">{entry.label}</div>
          <div className="font-mono text-[10px] text-slate-600">{entry.templateId}</div>
        </td>
        <td className="px-3 py-2 font-mono text-[11px]">{entry.expectedAsop}</td>
        <td className="px-3 py-2"><Pill ok={resolvedOk}>{resolved}</Pill></td>
        <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">{s?.counts?.actual ?? '—'}</td>
        <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">{s?.counts?.expected ?? '—'}</td>
        <td className="px-3 py-2">
          <Pill ok={entry.ok}>{entry.ok ? 'exact match' : entry.note}</Pill>
        </td>
      </tr>
      {open && (
        <tr className="bg-slate-900/40">
          <td colSpan={6} className="space-y-3 px-4 py-3 text-[12px] text-slate-400">
            {s?.failures?.length > 0 && (
              <div>
                <div className="text-[11px] tracking-wide text-slate-500 uppercase">Findings against the baseline</div>
                <ul className="mt-1 list-disc pl-5">
                  {s.failures.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              </div>
            )}
            {entry.stages?.find((st) => st.stage === 'resolve')?.value?.quoted_condition && (
              <div>
                <div className="text-[11px] tracking-wide text-slate-500 uppercase">What in the document it keyed on</div>
                <p className="mt-1">{entry.stages.find((st) => st.stage === 'resolve').value.quoted_condition}</p>
              </div>
            )}
            {entry.sql && (
              <div>
                <div className="text-[11px] tracking-wide text-slate-500 uppercase">Generated SQL</div>
                <pre className="mt-1 overflow-x-auto rounded border border-slate-800 bg-slate-950/60 p-3 font-mono text-[11px] text-slate-300">{entry.sql.trim()}</pre>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function AiTab() {
  const exact = generation?.entries.filter((e) => e.ok).length ?? 0;
  const resolvedRight =
    generation?.entries.filter(
      (e) => e.stages?.find((st) => st.stage === 'resolve')?.value?.asopId === e.expectedAsop,
    ).length ?? 0;
  const diag = diagnosis?.score;
  const dimsPassed = diag ? DIAG_DIMENSIONS.filter(([key]) => diag.dimensions?.[key]?.ok).length : 0;

  return (
    <div className="space-y-10">
      <p className="max-w-3xl text-[13px] leading-relaxed text-slate-500">
        Two language-model layers sit on top of the audit. One turns a messy procedure document into the detection
        logic that finds its misses. The other groups the misses by root cause. Each is graded against answers
        written by hand beforehand, and neither result was tuned after seeing scores. Where a layer failed, the failure is
        shown.
      </p>

      {/* Layer A ---------------------------------------------------------------- */}
      <section className="space-y-3">
        <div>
          <h2 className="text-[14px] font-semibold text-slate-100">Layer 1: procedure documents to detection logic</h2>
          <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-slate-500">
            Three separate model calls, on purpose: <span className="text-slate-300">resolve</span> which procedure the
            document describes, <span className="text-slate-300">extract</span> its condition in terms of the database,
            then <span className="text-slate-300">compose</span> the SQL. When something goes wrong the split shows which
            stage caused it. The SQL runs against the same data as the {BASELINES.length} hand-written baseline queries and
            is scored on resolution, execution, row counts, the actual rows, and structure.
          </p>
        </div>

        {generation ? (
          <>
            <div className="flex flex-wrap gap-x-8 gap-y-1 text-[12px] text-slate-400">
              <span>Resolved the right procedure: <span className="font-mono text-slate-100">{resolvedRight}/{generation.entries.length}</span></span>
              <span>Matched the baseline exactly: <span className="font-mono text-slate-100">{exact}/{generation.entries.length}</span></span>
              <span className="text-slate-600">
                {generation.model} · recorded {formatDate(generation.recordedAt)} · one run per document
              </span>
            </div>
            <div className="overflow-x-auto rounded border border-slate-800">
              <table className="w-full text-[12px]">
                <thead className="bg-slate-900/60 text-[11px] tracking-wide text-slate-500 uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Document</th>
                    <th className="px-3 py-2 text-left font-medium">Expected</th>
                    <th className="px-3 py-2 text-left font-medium">Resolved</th>
                    <th className="px-3 py-2 text-right font-medium">Rows</th>
                    <th className="px-3 py-2 text-right font-medium">Baseline</th>
                    <th className="px-3 py-2 text-left font-medium">Verdict</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {generation.entries.map((e) => <GenerationRow key={e.templateId} entry={e} />)}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-slate-600">Click a row for the generated SQL and what differed from the baseline.</p>
            <div className="max-w-3xl space-y-1.5 text-[12px] leading-relaxed text-slate-500">
              <div className="text-[11px] tracking-wide text-slate-500 uppercase">Reading this run</div>
              <p>
                <span className="text-slate-300">Resolution was 5 for 5</span>, including telling apart the two port
                procedures that share a table and differ only in the state they watch and the wait.
              </p>
              <p>
                <span className="text-slate-300">The hold document returned 3 extra rows.</span> They are holds whose
                department is blank rather than empty (NULL). The generated query checks for both, so it arguably beats
                the baseline. The baseline stays as written, because a defect the automation misses and a defect its
                criteria are too narrow to see are different findings.
              </p>
              <p>
                <span className="text-slate-300">The queue-deadline document returned 36 rows against 4.</span> The
                extraction stage measured the countdown from the end of the analysis window instead of from each
                batch&rsquo;s own latest event, and treated finished states as a bypass instead of excluding them. Both
                errors appear in the extraction output, before any SQL was written, which is what the three-stage split is
                for.
              </p>
              <p>
                <span className="text-slate-300">The missed-check document never produced runnable SQL.</span> The compose
                stage returned more than one statement, which the guardrail rejects. It was not retried.
              </p>
            </div>
          </>
        ) : (
          <NotRecorded command="npm run gen:check -- --save" />
        )}
      </section>

      {/* Layer B ---------------------------------------------------------------- */}
      <section className="space-y-3">
        <div>
          <h2 className="text-[14px] font-semibold text-slate-100">Layer 2: grouping misses by root cause</h2>
          <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-slate-500">
            One model call over all 24 misses, the detection definition of each procedure, and the platform's
            availability record. Detection and diagnosis are separate questions, so a wrong diagnosis never hides a real
            miss. The data was built to trip a lazy answer: grouping by time alone gets it wrong twice. The answer key
            has {EXPECTED_FINDINGS.length} findings, written by hand as data rather than rules.
          </p>
        </div>

        {diagnosis ? (
          <>
            <div className="flex flex-wrap gap-x-8 gap-y-1 text-[12px] text-slate-400">
              <span>Checks passed: <span className="font-mono text-slate-100">{dimsPassed}/{DIAG_DIMENSIONS.length}</span></span>
              <span>Findings returned: <span className="font-mono text-slate-100">{diagnosis.findings.length}</span> (key: {EXPECTED_FINDINGS.length})</span>
              <span className="text-slate-600">{diagnosis.model} · recorded {formatDate(diagnosis.recordedAt)} · one call</span>
            </div>
            <div className="overflow-hidden rounded border border-slate-800">
              <table className="w-full text-[12px]">
                <tbody className="divide-y divide-slate-800/70">
                  {DIAG_DIMENSIONS.map(([key, label]) => (
                    <tr key={key} className="text-slate-300">
                      <td className="px-3 py-2">{label}</td>
                      <td className="w-24 px-3 py-2 text-right">
                        <Pill ok={diag.dimensions?.[key]?.ok}>{diag.dimensions?.[key]?.ok ? 'pass' : 'fail'}</Pill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {diag.failures?.length > 0 && (
              <div className="rounded border border-slate-800 bg-slate-900/40 px-4 py-3 text-[12px] text-slate-400">
                <div className="text-[11px] tracking-wide text-slate-500 uppercase">Where it went wrong</div>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {diag.failures.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              </div>
            )}
            <div className="max-w-3xl space-y-1.5 text-[12px] leading-relaxed text-slate-500">
              <div className="text-[11px] tracking-wide text-slate-500 uppercase">Reading this run</div>
              <p>
                <span className="text-slate-300">It recovered the outage cluster exactly:</span> the 8 misses across four
                procedures that fell inside the six-hour outage, classed as infrastructure with one system-level fix.
              </p>
              <p>
                <span className="text-slate-300">It fell for two of the traps the data was built to test.</span> It
                blamed the outage for a hold whose detection has no time component, so the outage cannot explain it. And
                it grouped two missed checks because both had a skip reason recorded, when only one of those skips is the
                problem. It also called one retry-ceiling miss unexplained where the key calls it a logic gap.
              </p>
              <p>
                It was willing to answer &ldquo;unexplained&rdquo; for four misses instead of inventing a cause, which
                is a real answer (though one of those four is a miss the key does explain).
              </p>
            </div>
            <details className="rounded border border-slate-800">
              <summary className="cursor-pointer px-3 py-2 text-[12px] text-slate-300">Model findings</summary>
              <div className="divide-y divide-slate-800/70">
                {diagnosis.findings.map((f, i) => (
                  <div key={i} className="px-3 py-2 text-[12px]">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-slate-200">{f.title}</span>
                      <span className="shrink-0 font-mono text-[11px] text-sky-300">{f.causeClass} · {f.missIds.length}</span>
                    </div>
                    {f.cause && <div className="mt-0.5 text-slate-500">{f.cause}</div>}
                  </div>
                ))}
              </div>
            </details>
          </>
        ) : (
          <NotRecorded command="npm run diag:check -- --save" />
        )}
      </section>

      <section className="max-w-3xl text-[12px] leading-relaxed text-slate-500">
        <h2 className="text-[13px] font-semibold text-slate-200">How these are graded, and what to conclude</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            The baselines and the answer key are written by hand. Rules that separate the planted clusters would be
            written knowing what was planted, so a model reproducing them would prove nothing.
          </li>
          <li>
            Both scorers are tested to fail: <span className="font-mono">gen:check --self-test</span> and{' '}
            <span className="font-mono">diag:check --self-test</span> feed deliberately wrong answers through and require
            them to be rejected, including the answer a plain group-by-time would produce.
          </li>
          <li>
            One run each, on synthetic data with five documents and one diagnosis. That is a demonstration, not a
            benchmark; a different run could score differently, and the prompts were not tuned toward the answers. One change was made before this run: the first stage originally asked the model to explain its reasoning, which the API intermittently refused, so it now asks for a quote from the document instead. Nothing was changed after seeing scores.
          </li>
          <li>The model can write detection logic that finds more than the baseline. That is reported as a finding about the baseline's criteria, not hidden as an error.</li>
        </ul>
      </section>
    </div>
  );
}
