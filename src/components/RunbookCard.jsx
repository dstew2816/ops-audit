import { formatDuration } from '../engine/time';

function Field({ label, children }) {
  return (
    <div>
      <dt className="text-[10px] font-medium tracking-wider text-slate-500 uppercase">
        {label}
      </dt>
      <dd className="mt-1 text-[13px] text-slate-300">{children}</dd>
    </div>
  );
}

const Code = ({ children }) => (
  <code className="rounded bg-slate-800/80 px-1.5 py-0.5 font-mono text-[12px] text-slate-200">
    {children}
  </code>
);

export default function RunbookCard({ runbook, fired, expected, logged, missed }) {
  return (
    <article className="flex flex-col rounded-lg border border-slate-800 bg-slate-900/40">
      <header className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-[12px] text-sky-400">{runbook.id}</span>
            <h2 className="text-[15px] font-semibold text-slate-100">
              {runbook.name}
            </h2>
          </div>
          <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-slate-500">
            {runbook.description}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-2xl leading-none text-slate-100 tabular-nums">
            {fired}
          </div>
          <div className="mt-1.5 text-[10px] tracking-wider text-slate-500 uppercase">
            fired in window
          </div>
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 px-5 py-4">
        <Field label="Resource type">
          <Code>{runbook.resourceType}</Code>
        </Field>
        <Field label="Trigger state">
          <Code>{runbook.triggerState}</Code>
        </Field>
        <Field label="Threshold">
          {formatDuration(runbook.thresholdMinutes)}
          <span className="ml-1.5 text-slate-500">
            continuous in trigger state
          </span>
        </Field>
        <Field label="Action">
          <Code>{runbook.action}</Code>
        </Field>
        <Field label="Excluded resources">
          {runbook.exclusionList.length ? (
            <span className="flex flex-wrap gap-1">
              {runbook.exclusionList.map((id) => (
                <span
                  key={id}
                  className="rounded border border-slate-700 bg-slate-800/60 px-1.5 py-0.5 font-mono text-[11px] text-slate-400"
                >
                  {id}
                </span>
              ))}
            </span>
          ) : (
            <span className="text-slate-600">none</span>
          )}
        </Field>
        <Field label="Excluded resource types">
          {runbook.excludedResourceTypes.length ? (
            <span className="flex flex-wrap gap-1">
              {runbook.excludedResourceTypes.map((type) => (
                <span
                  key={type}
                  className="rounded border border-slate-700 bg-slate-800/60 px-1.5 py-0.5 font-mono text-[11px] text-slate-400"
                >
                  {type}
                </span>
              ))}
            </span>
          ) : (
            <span className="text-slate-600">none</span>
          )}
        </Field>
      </dl>

      <footer className="mt-auto grid grid-cols-3 divide-x divide-slate-800 border-t border-slate-800 text-center">
        {[
          { label: 'expected', value: expected, tone: 'text-slate-200' },
          { label: 'logged', value: logged, tone: 'text-emerald-400' },
          { label: 'missed', value: missed, tone: missed ? 'text-amber-400' : 'text-slate-600' },
        ].map((cell) => (
          <div key={cell.label} className="px-3 py-3">
            <div className={`font-mono text-[15px] tabular-nums ${cell.tone}`}>
              {cell.value}
            </div>
            <div className="mt-1 text-[10px] tracking-wider text-slate-500 uppercase">
              {cell.label}
            </div>
          </div>
        ))}
      </footer>

      <div className="border-t border-slate-800 px-5 py-2.5 text-[11px] text-slate-500">
        Owner: <span className="text-slate-400">{runbook.owner}</span>
      </div>
    </article>
  );
}
