// The two AI layers, with their live results graded against hand-written
// baselines. The page only DISPLAYS saved results; the model calls happen in
// Node (`npm run gen:check -- --save`, `npm run diag:check -- --save`), so the
// browser never holds an API key. Results files are optional: without them the
// tab says nothing has been recorded rather than inventing numbers.

import { More } from './More.jsx';
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
  <span className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${ok ? 'border border-slate-700 text-slate-400' : 'border border-rose-400/40 bg-rose-500/10 text-rose-300'}`}>
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

// A plain-words verdict for each document, instead of the scorer's internal note.
function verdict(entry) {
  if (entry.ok) return 'exact match';
  const c = entry.score?.counts;
  if (!c || c.actual == null) return 'no runnable query';
  if (c.actual > c.expected) return `${c.actual - c.expected} extra rows`;
  if (c.actual < c.expected) return `${c.expected - c.actual} rows missing`;
  return 'same count, different rows';
}

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
          <Pill ok={entry.ok}>{verdict(entry)}</Pill>
        </td>
      </tr>
      {open && (
        <tr className="bg-slate-900">
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
    <div className="space-y-14">
      <p className="max-w-3xl text-[15px] leading-[1.75] text-slate-400">
        Two language-model layers sit on top of the audit. One turns a messy procedure document into the detection query
        that finds its misses, and the other groups the misses by root cause. Each is graded against answers written by
        hand beforehand, nothing was tuned after the scores were seen, and the failures are shown where they happened.
      </p>

      {/* Layer A ---------------------------------------------------------------- */}
      <section className="space-y-3">
        <div>
          <h2 className="text-[18px] font-semibold tracking-tight text-slate-100">Layer 1: procedure documents to detection logic</h2>
          <p className="mt-2 max-w-3xl text-[14px] leading-[1.7] text-slate-400">
            The work is split into three separate calls: the first <span className="text-slate-300">resolves</span> which
            procedure the document describes, the second <span className="text-slate-300">extracts</span> its condition in
            terms of the database, and the third <span className="text-slate-300">writes</span> the query in SQL (Structured
            Query Language). When a result is wrong, the split shows which step caused it. The query runs against the same
            data as the {BASELINES.length} hand-written baseline queries and is scored on resolution, execution, row counts,
            the rows themselves and structure.
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
            <div className="overflow-x-auto rounded border border-slate-800 bg-slate-900">
              <table className="w-full text-[12px]">
                <thead className="border-b border-slate-800 text-[11px] tracking-wide text-slate-500 uppercase">
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
            <p className="max-w-3xl text-[14px] leading-[1.7] text-slate-300">
              It picked the right procedure for all five documents. Two queries matched the hand-written ones exactly, two returned extra rows, and one never ran.
            </p>
            <More label="What went right and wrong, document by document">
            <div className="max-w-3xl space-y-3 text-[14px] leading-[1.7] text-slate-400">
              <p>
                The right procedure was resolved for all five documents, including the two port procedures that share a
                table and differ only in the state they watch and how long they wait.
              </p>
              <p>
                The hold document returned 3 extra rows, which are holds whose department is blank rather than empty
                (NULL). The generated query checks for both, so it arguably does better than the baseline. I left the
                baseline as written, because a defect the automation misses and a defect its criteria are too narrow to
                see are different findings.
              </p>
              <p>
                The queue-deadline document returned 36 rows against 4. The extraction step measured the countdown from the
                end of the analysis window instead of from each batch&rsquo;s own latest event, and treated finished states as
                a bypass instead of excluding them. Both errors appear in the extraction output, before any SQL was written,
                which is the reason for splitting the work into three steps.
              </p>
              <p>
                The missed-check document never produced runnable SQL, because the third step returned more than one
                statement and the guardrail rejects that. I did not retry it.
              </p>
            </div>
            </More>
          </>
        ) : (
          <NotRecorded command="npm run gen:check -- --save" />
        )}
      </section>

      {/* Layer B ---------------------------------------------------------------- */}
      <section className="space-y-3">
        <div>
          <h2 className="text-[18px] font-semibold tracking-tight text-slate-100">Layer 2: grouping misses by root cause</h2>
          <p className="mt-2 max-w-3xl text-[14px] leading-[1.7] text-slate-400">
            One model call covers all 24 misses, the detection definition of each procedure and the platform&rsquo;s
            availability record. Detection and diagnosis are separate questions, so a wrong diagnosis cannot hide a real
            miss. The data was built so that grouping by time alone gets it wrong twice. The answer key has{' '}
            {EXPECTED_FINDINGS.length} findings and is written by hand as data, not as rules.
          </p>
        </div>

        {diagnosis ? (
          <>
            <div className="flex flex-wrap gap-x-8 gap-y-1 text-[12px] text-slate-400">
              <span>Checks passed: <span className="font-mono text-slate-100">{dimsPassed}/{DIAG_DIMENSIONS.length}</span></span>
              <span>Findings returned: <span className="font-mono text-slate-100">{diagnosis.findings.length}</span> (key: {EXPECTED_FINDINGS.length})</span>
              <span className="text-slate-600">{diagnosis.model} · recorded {formatDate(diagnosis.recordedAt)} · one call</span>
            </div>
            <div className="overflow-hidden rounded border border-slate-800 bg-slate-900">
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
            <p className="max-w-3xl text-[14px] leading-[1.7] text-slate-300">
              It recovered the outage cluster exactly, which is the finding worth the most, and made two of the mistakes the data was built to provoke.
            </p>
            <More label="What it got right and wrong">
            {diag.failures?.length > 0 && (
              <div className="rounded border border-slate-800 bg-slate-900 px-4 py-3 text-[12px] text-slate-400">
                <div className="text-[11px] tracking-wide text-slate-500 uppercase">Where it went wrong</div>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {diag.failures.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              </div>
            )}
            <div className="max-w-3xl space-y-3 text-[14px] leading-[1.7] text-slate-400">
              <p>
                It recovered the outage cluster exactly: the 8 misses across four procedures that fell inside the
                six-hour outage, classed as infrastructure with one system-level fix.
              </p>
              <p>
                It made two of the mistakes the data was built to provoke. It blamed the outage for a hold whose detection
                has no time component, so the outage cannot explain it, and it grouped two missed checks because both had a
                skip reason recorded, when only one of those skips is the problem. It also called one retry-ceiling miss
                unexplained where the key calls it a logic gap.
              </p>
              <p>
                It answered &ldquo;unexplained&rdquo; for four misses instead of inventing a cause, which is a legitimate
                answer, although one of those four is a miss that the key does explain.
              </p>
            </div>
            </More>
            <details className="more rounded border border-slate-800 bg-slate-900">
              <summary className="px-4 py-2.5 text-[13px] text-slate-200">Model findings</summary>
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

      <More label="How the grading works">
      <section className="max-w-3xl text-[14px] leading-[1.7] text-slate-400">
        <ul className=" list-disc space-y-1 pl-5">
          <li>
            The baselines and the answer key are written by hand. Rules that separate the planted clusters would be
            written knowing what was planted, so a model that reproduced them would prove nothing.
          </li>
          <li>
            Both scorers are tested with deliberately wrong answers (<span className="font-mono">gen:check --self-test</span> and{' '}
            <span className="font-mono">diag:check --self-test</span>), which they must reject, including the answer a plain
            group-by-time would produce.
          </li>
          <li>
            Each layer was run once, on five documents and one diagnosis, so this is a demonstration of the method and a
            different run could score differently. One change was made before the recorded run: the first step originally
            asked the model to explain its reasoning, the API declined that request in testing, and it now asks for a quote from
            the document instead. Nothing was changed after the scores were seen.
          </li>
          <li>When the model writes a query that finds more than the baseline, I report that as a finding about the baseline&rsquo;s criteria instead of treating it as an error.</li>
        </ul>
      </section>
      </More>
    </div>
  );
}
