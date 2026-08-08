import { useMemo, useState } from 'react';
import { templates } from '../data/templates';
import { runbooksById } from '../data/runbooks';
import { events, ANALYSIS_END } from '../data/events';
import { executionLog } from '../data/executionLog';
import { detect } from '../engine/detect';
import {
  MODEL,
  isDemoMode,
  FIXTURES_ARE_SYNTHETIC,
  generate,
  parseGenerated,
  toRunbook,
  diffAgainstConfigured,
} from '../engine/generate';
import GeneratedDetection from './GeneratedDetection';

const Code = ({ children }) => (
  <code className="rounded bg-slate-800/80 px-1.5 py-0.5 font-mono text-[12px] text-slate-200">
    {children}
  </code>
);

/** Arrays render as chips so a set difference is visible at a glance. */
function FieldValue({ value }) {
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-slate-600">none</span>;
    return (
      <span className="flex flex-wrap gap-1">
        {value.map((v) => (
          <span
            key={v}
            className="rounded border border-slate-700 bg-slate-800/60 px-1.5 py-0.5 font-mono text-[11px] text-slate-400"
          >
            {v}
          </span>
        ))}
      </span>
    );
  }
  return <span className="font-mono text-[12px] text-slate-300">{String(value)}</span>;
}

function ModeBanner() {
  if (!isDemoMode) {
    return (
      <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-2.5 text-[12px] leading-relaxed text-sky-200">
        <span className="font-semibold">Live generation.</span> A key is present in this build, so
        Generate calls the Anthropic API directly from the browser using{' '}
        <Code>{MODEL}</Code>. Never build for deployment with the key set — Vite inlines it into
        the bundle in plain text.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-[12px] leading-relaxed text-amber-200">
      <span className="font-semibold">Demo mode — responses are recorded, not live.</span> This
      build carries no API key, so Generate replays a stored response for each preset as written
      rather than calling the model. Editing a template leaves it with no matching recording.
      {FIXTURES_ARE_SYNTHETIC && (
        <>
          {' '}
          <span className="font-semibold">
            The stored responses are hand-written placeholders
          </span>{' '}
          — they were authored to the response schema rather than captured from a real call. Run{' '}
          <Code>npm run record</Code> with a key to replace them with genuine captures.
        </>
      )}
    </div>
  );
}

export default function GenerateTab() {
  const [templateId, setTemplateId] = useState(templates[0].id);
  const [text, setText] = useState(templates[0].text);
  const [status, setStatus] = useState('idle'); // idle | running | done | error
  const [error, setError] = useState(null);
  const [response, setResponse] = useState(null);
  const [showDetection, setShowDetection] = useState(false);

  const template = templates.find((t) => t.id === templateId);
  const configured = runbooksById[template.runbookId];

  const parsed = useMemo(
    () => (response ? parseGenerated(response.raw) : null),
    [response],
  );

  const generatedRunbook = useMemo(() => {
    if (!parsed?.ok) return null;
    return toRunbook(parsed.value, {
      id: configured.id,
      description: `Generated from ${template.label}.`,
    });
  }, [parsed, configured.id, template.label]);

  const diff = useMemo(
    () => (generatedRunbook ? diffAgainstConfigured(generatedRunbook, configured) : null),
    [generatedRunbook, configured],
  );

  // Both runs use the same events and execution log, so the miss sets differ
  // only where the two definitions differ.
  const detection = useMemo(() => {
    if (!showDetection || !generatedRunbook) return null;
    return {
      generated: detect({
        events,
        runbooks: [generatedRunbook],
        executionLog,
        analysisEnd: ANALYSIS_END,
      }),
      baseline: detect({
        events,
        runbooks: [configured],
        executionLog,
        analysisEnd: ANALYSIS_END,
      }),
    };
  }, [showDetection, generatedRunbook, configured]);

  function selectTemplate(id) {
    const next = templates.find((t) => t.id === id);
    setTemplateId(id);
    setText(next.text);
    reset();
  }

  function reset() {
    setStatus('idle');
    setError(null);
    setResponse(null);
    setShowDetection(false);
  }

  async function onGenerate() {
    setStatus('running');
    setError(null);
    setResponse(null);
    setShowDetection(false);
    try {
      setResponse(await generate({ templateId, templateText: text }));
      setStatus('done');
    } catch (e) {
      setError(e.message || String(e));
      setStatus('error');
    }
  }

  const isEdited = text !== template.text;

  return (
    <div className="space-y-5">
      <ModeBanner />

      {/* ---------------------------------------------------------------- */}
      <section className="rounded-lg border border-slate-800 bg-slate-900/40">
        <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-slate-800 px-5 py-3">
          <h2 className="text-[13px] font-semibold tracking-wide text-slate-200 uppercase">
            Runbook documentation
          </h2>
          <p className="max-w-2xl text-[12px] leading-relaxed text-slate-500">
            Process documentation as it exists internally. Mixed languages, superseded values left
            beside current ones, exclusions buried in prose. The platform cannot execute any of it.
          </p>
        </header>

        <div className="flex flex-wrap gap-2 border-b border-slate-800 px-5 py-3">
          {templates.map((t) => {
            const active = t.id === templateId;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => selectTemplate(t.id)}
                className={[
                  'rounded border px-3 py-1.5 text-left text-[12px] transition-colors',
                  active
                    ? 'border-sky-500/50 bg-sky-500/10 text-slate-100'
                    : 'border-slate-700 bg-slate-800/40 text-slate-400 hover:border-slate-600 hover:text-slate-200',
                ].join(' ')}
              >
                <div className="font-medium">{t.label}</div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  documents <span className="font-mono">{t.runbookId}</span> &middot; {t.note}
                </div>
              </button>
            );
          })}
        </div>

        <div className="px-5 py-4">
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (status !== 'idle') reset();
            }}
            spellCheck={false}
            rows={18}
            aria-label="Runbook documentation"
            className="w-full resize-y rounded border border-slate-700 bg-slate-950/60 px-3 py-2.5 font-mono text-[12px] leading-relaxed text-slate-300 outline-none focus:border-sky-500/60"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onGenerate}
              disabled={status === 'running' || !text.trim()}
              className="rounded bg-sky-500/90 px-4 py-2 text-[13px] font-medium text-slate-950 transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500"
            >
              {status === 'running' ? 'Generating…' : 'Generate audit logic'}
            </button>
            {isEdited && (
              <button
                type="button"
                onClick={() => selectTemplate(templateId)}
                className="text-[12px] text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
              >
                Reset to preset
              </button>
            )}
            <span className="text-[12px] text-slate-500">
              {isEdited ? (
                <>
                  Edited.{' '}
                  {isDemoMode
                    ? 'Demo mode has no recording for this text.'
                    : 'Will be sent to the model as written.'}
                </>
              ) : (
                <>Unmodified preset.</>
              )}
            </span>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {status === 'error' && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-5 py-3 text-[13px] leading-relaxed text-rose-200">
          <span className="font-semibold">Generation failed.</span> {error}
        </div>
      )}

      {response && parsed && (
        <>
          <section className="rounded-lg border border-slate-800 bg-slate-900/40">
            <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-slate-800 px-5 py-3">
              <h2 className="text-[13px] font-semibold tracking-wide text-slate-200 uppercase">
                Model output
              </h2>
              <dl className="flex flex-wrap gap-5 text-[11px] text-slate-500">
                <div className="flex gap-1.5">
                  <dt>Source</dt>
                  <dd className="font-mono text-slate-400">
                    {response.source === 'live' ? 'live call' : 'recorded'}
                  </dd>
                </div>
                <div className="flex gap-1.5">
                  <dt>Model</dt>
                  <dd className="font-mono text-slate-400">{response.model}</dd>
                </div>
                {response.usage && (
                  <div className="flex gap-1.5">
                    <dt>Tokens</dt>
                    <dd className="font-mono text-slate-400">
                      {response.usage.inputTokens} in / {response.usage.outputTokens} out
                    </dd>
                  </div>
                )}
                {response.elapsedMs != null && (
                  <div className="flex gap-1.5">
                    <dt>Elapsed</dt>
                    <dd className="font-mono text-slate-400">
                      {(response.elapsedMs / 1000).toFixed(1)}s
                    </dd>
                  </div>
                )}
                {response.recordedAt && (
                  <div className="flex gap-1.5">
                    <dt>Recorded</dt>
                    <dd className="font-mono text-slate-400">
                      {response.recordedAt.slice(0, 10)}
                    </dd>
                  </div>
                )}
              </dl>
            </header>

            <div className="grid gap-px bg-slate-800 lg:grid-cols-2">
              {/* raw ------------------------------------------------------ */}
              <div className="bg-slate-900/40">
                <h3 className="border-b border-slate-800 px-5 py-2.5 text-[11px] font-medium tracking-wider text-slate-500 uppercase">
                  Raw response
                </h3>
                <pre className="max-h-[26rem] overflow-auto px-5 py-4 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-slate-400">
                  {response.raw}
                </pre>
              </div>

              {/* parsed --------------------------------------------------- */}
              <div className="bg-slate-900/40">
                <h3 className="border-b border-slate-800 px-5 py-2.5 text-[11px] font-medium tracking-wider text-slate-500 uppercase">
                  Parsed runbook definition
                </h3>
                {parsed.ok ? (
                  <div className="px-5 py-4">
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
                      <div className="col-span-2">
                        <dt className="text-[10px] font-medium tracking-wider text-slate-500 uppercase">
                          Name
                        </dt>
                        <dd className="mt-1 text-[13px] text-slate-200">{parsed.value.name}</dd>
                      </div>
                      {[
                        ['Resource type', parsed.value.resourceType],
                        ['Trigger state', parsed.value.triggerState],
                        ['Threshold (min)', parsed.value.thresholdMinutes],
                        ['Action', parsed.value.action],
                        ['Owner', parsed.value.owner],
                        ['Excluded types', parsed.value.excludedResourceTypes],
                        ['Exclusion list', parsed.value.exclusionList],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <dt className="text-[10px] font-medium tracking-wider text-slate-500 uppercase">
                            {label}
                          </dt>
                          <dd className="mt-1 text-[13px]">
                            <FieldValue value={value} />
                          </dd>
                        </div>
                      ))}
                    </dl>

                    {parsed.value.notes && (
                      <div className="mt-5 border-t border-slate-800 pt-4">
                        <div className="text-[10px] font-medium tracking-wider text-slate-500 uppercase">
                          Model notes on the source document
                        </div>
                        <p className="mt-1.5 text-[13px] leading-relaxed text-slate-400">
                          {parsed.value.notes}
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="px-5 py-4">
                    <p className="text-[13px] text-rose-300">
                      The response did not validate as a runbook definition.
                    </p>
                    <ul className="mt-3 space-y-1.5">
                      {parsed.errors.map((e) => (
                        <li key={e} className="font-mono text-[12px] text-rose-300/80">
                          {e}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* -------------------------------------------------------------- */}
          {diff && (
            <section className="rounded-lg border border-slate-800 bg-slate-900/40">
              <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-slate-800 px-5 py-3">
                <h2 className="text-[13px] font-semibold tracking-wide text-slate-200 uppercase">
                  Against {configured.id} as configured
                </h2>
                <p className="text-[12px] text-slate-500">
                  {diff.every((f) => f.match)
                    ? 'Every field matches the platform configuration.'
                    : `${diff.filter((f) => !f.match).length} field(s) differ.`}
                </p>
              </header>
              <table className="w-full text-left text-[13px]">
                <thead className="text-[10px] tracking-wider text-slate-500 uppercase">
                  <tr className="border-b border-slate-800">
                    <th className="px-5 py-2 font-medium">Field</th>
                    <th className="px-3 py-2 font-medium">Generated</th>
                    <th className="px-3 py-2 font-medium">Configured</th>
                    <th className="px-3 py-2 font-medium">&nbsp;</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {diff.map((field) => (
                    <tr key={field.key} className={field.match ? '' : 'bg-amber-500/[0.04]'}>
                      <td className="px-5 py-2.5 text-slate-400">{field.label}</td>
                      <td className="px-3 py-2.5">
                        <FieldValue value={field.generated} />
                      </td>
                      <td className="px-3 py-2.5">
                        <FieldValue value={field.configured} />
                      </td>
                      <td className="px-3 py-2.5 text-[11px]">
                        {field.match ? (
                          <span className="text-slate-600">match</span>
                        ) : (
                          <span className="text-amber-400">differs</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* -------------------------------------------------------------- */}
          {parsed.ok && !showDetection && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-5 py-4">
              <button
                type="button"
                onClick={() => setShowDetection(true)}
                className="rounded bg-sky-500/90 px-4 py-2 text-[13px] font-medium text-slate-950 transition-colors hover:bg-sky-400"
              >
                Run detection with this definition
              </button>
              <span className="max-w-2xl text-[12px] leading-relaxed text-slate-500">
                Reconstructs intervals from the same event stream and anti-joins the same execution
                log, using the generated definition in place of{' '}
                <span className="font-mono text-slate-400">{configured.id}</span>.
              </span>
            </div>
          )}

          {detection && generatedRunbook && (
            <GeneratedDetection
              runbook={generatedRunbook}
              result={detection.generated}
              baseline={detection.baseline}
              baselineRunbook={configured}
            />
          )}
        </>
      )}
    </div>
  );
}
