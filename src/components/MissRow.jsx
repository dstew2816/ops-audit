import {
  formatDuration,
  formatTimestamp,
  formatTimestampPrecise,
  formatOffset,
  formatLag,
} from '../engine/time';

const Code = ({ children, tone = 'text-slate-200' }) => (
  <code className={`rounded bg-slate-800/80 px-1.5 py-0.5 font-mono text-[12px] ${tone}`}>
    {children}
  </code>
);

function Panel({ title, children }) {
  return (
    <section className="rounded border border-slate-800 bg-slate-950/50">
      <h4 className="border-b border-slate-800 px-4 py-2 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
        {title}
      </h4>
      <div className="space-y-2.5 px-4 py-3 text-[13px] leading-relaxed">
        {children}
      </div>
    </section>
  );
}

function Line({ label, children }) {
  return (
    <div className="flex gap-3">
      <span className="w-40 shrink-0 text-[12px] text-slate-500">{label}</span>
      <span className="min-w-0 flex-1 text-slate-300">{children}</span>
    </div>
  );
}

const STATUS_TONE = {
  up: 'text-emerald-400',
  degraded: 'text-amber-400',
  down: 'text-rose-400',
};

export default function MissRow({ miss, expanded, onToggle }) {
  return (
    <>
      <tr
        onClick={onToggle}
        aria-expanded={expanded}
        className={`cursor-pointer border-b border-slate-800/70 transition-colors ${
          expanded ? 'bg-slate-800/40' : 'hover:bg-slate-800/25'
        }`}
      >
        <td className="py-2.5 pr-2 pl-5">
          <span
            className={`inline-block font-mono text-[11px] text-slate-500 transition-transform ${
              expanded ? 'rotate-90' : ''
            }`}
          >
            &gt;
          </span>
        </td>
        <td className="px-3 py-2.5 font-mono text-[12px] text-slate-100">
          {miss.resourceId}
        </td>
        <td className="px-3 py-2.5 text-[12px] text-slate-500">
          {miss.resourceType}
        </td>
        <td className="px-3 py-2.5">
          <span className="font-mono text-[12px] text-sky-400">{miss.runbookId}</span>
          <span className="ml-2 text-slate-400">{miss.runbookName}</span>
        </td>
        <td className="px-3 py-2.5 font-mono text-[12px] text-slate-400">
          {miss.state}
        </td>
        <td className="px-3 py-2.5 font-mono text-[12px] text-slate-300">
          {formatTimestamp(miss.intervalStart)}
        </td>
        <td className="px-3 py-2.5 font-mono text-[12px] text-slate-300">
          {formatTimestamp(miss.intervalEnd)}
        </td>
        <td className="px-3 py-2.5 text-right font-mono text-[12px] text-amber-400 tabular-nums">
          {formatDuration(miss.durationMinutes)}
        </td>
        <td className="px-3 py-2.5 text-right font-mono text-[12px] text-slate-500 tabular-nums">
          {formatDuration(miss.thresholdMinutes)}
        </td>
        <td className="py-2.5 pr-5 pl-3">
          <div className="flex flex-wrap justify-end gap-1">
            {miss.excluded && (
              <span className="rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                excluded
              </span>
            )}
            {miss.candidates.length > 0 && (
              <span className="rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                {miss.candidates.length} log
                {miss.candidates.length > 1 ? 's' : ''} out of window
              </span>
            )}
            {miss.ingestLagMinutes >= 60 && (
              <span className="rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                ingest lag {formatDuration(miss.ingestLagMinutes)}
              </span>
            )}
            {miss.platformStatus.some((p) => p.status !== 'up') && (
              <span className="rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                platform {miss.platformStatus[0].status}
              </span>
            )}
          </div>
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-slate-800/70 bg-slate-900/60">
          <td colSpan={10} className="px-5 py-4">
            <div className="grid gap-3 lg:grid-cols-2">
              <Panel title="Reconstructed interval">
                <Line label="Opened by">
                  <Code>{miss.startEventId}</Code> set state to{' '}
                  <Code tone="text-amber-300">{miss.state}</Code> at{' '}
                  <span className="font-mono text-[12px]">
                    {formatTimestampPrecise(miss.intervalStart)}
                  </span>
                </Line>
                <Line label="Closed by">
                  {miss.endEventId ? (
                    <>
                      <Code>{miss.endEventId}</Code> at{' '}
                      <span className="font-mono text-[12px]">
                        {formatTimestampPrecise(miss.intervalEnd)}
                      </span>
                    </>
                  ) : (
                    <span className="text-slate-400">
                      no subsequent event; interval left open and closed at the
                      end of the analysis window
                    </span>
                  )}
                </Line>
                <Line label="Duration">
                  <span className="text-amber-400">
                    {formatDuration(miss.durationMinutes)}
                  </span>{' '}
                  continuous, exceeding the{' '}
                  {formatDuration(miss.thresholdMinutes)} threshold by{' '}
                  {formatDuration(miss.exceededThresholdByMinutes)}
                </Line>
                <Line label="Event ingested">
                  <span className="font-mono text-[12px]">
                    {formatTimestampPrecise(miss.startEventIngest)}
                  </span>
                  <span className="text-slate-500">
                    {' '}
                    &mdash; {formatLag(miss.ingestLagMinutes)} after the state
                    change
                    {miss.ingestLagMinutes >= 60 &&
                      '. The platform could not have evaluated this condition before that point.'}
                  </span>
                </Line>
                <Line label="Platform status">
                  {miss.platformStatus.map((w, i) => (
                    <span key={w.windowId}>
                      {i > 0 && <span className="text-slate-600">, </span>}
                      <span className={STATUS_TONE[w.status]}>{w.status}</span>
                      <span className="text-slate-500"> ({w.windowId})</span>
                    </span>
                  ))}
                </Line>
              </Panel>

              <Panel title="Why no matching execution was found">
                <Line label="Trigger match">
                  state <Code>{miss.state}</Code> equals{' '}
                  <Code>{miss.runbookId}</Code> triggerState{' '}
                  <Code>{miss.triggerState}</Code>, and the resource type{' '}
                  <Code>{miss.resourceType}</Code> is in scope
                </Line>
                <Line label="Exclusions">
                  {miss.excluded ? (
                    <>
                      <span className="text-slate-200">
                        matched <Code>{miss.excludedBy}</Code> on{' '}
                        <Code>{miss.excludedValue}</Code>
                      </span>
                      <span className="text-slate-500">
                        {' '}
                        &mdash; the platform was configured not to act here. The
                        interval is still reported: the condition held and nothing
                        addressed it.
                      </span>
                    </>
                  ) : (
                    <span className="text-slate-500">
                      resource is not on <Code>exclusionList</Code> and its type is
                      not in <Code>excludedResourceTypes</Code>
                    </span>
                  )}
                </Line>
                <Line label="Searched">
                  <span className="font-mono text-[12px]">
                    {formatTimestampPrecise(miss.toleranceWindowStart)}
                  </span>{' '}
                  &rarr;{' '}
                  <span className="font-mono text-[12px]">
                    {formatTimestampPrecise(miss.toleranceWindowEnd)}
                  </span>
                  <div className="mt-1 text-[12px] text-slate-500">
                    the interval, widened by {miss.clockDriftMinutes}m for clock
                    drift at the leading edge and{' '}
                    {miss.pollingToleranceMinutes}m poll cycle plus{' '}
                    {miss.clockDriftMinutes}m drift at the trailing edge
                  </div>
                </Line>
                <Line label="Anti-join">
                  {miss.candidates.length === 0 ? (
                    <span className="text-slate-400">
                      no execution of <Code>{miss.runbookId}</Code> against{' '}
                      <Code>{miss.resourceId}</Code> exists anywhere in the log.
                    </span>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="text-slate-400">
                        {miss.candidates.length} execution
                        {miss.candidates.length > 1 ? 's' : ''} of{' '}
                        <Code>{miss.runbookId}</Code> against{' '}
                        <Code>{miss.resourceId}</Code> found, none inside the
                        window:
                      </div>
                      <table className="w-full font-mono text-[11px]">
                        <tbody className="divide-y divide-slate-800">
                          {miss.candidates.map((c) => (
                            <tr key={c.logId}>
                              <td className="py-1.5 pr-3 text-slate-500">
                                {c.logId}
                              </td>
                              <td className="py-1.5 pr-3 text-slate-300">
                                {formatTimestampPrecise(c.firedAt)}
                              </td>
                              <td className="py-1.5 pr-3 text-slate-500">
                                {c.outcome}
                              </td>
                              <td className="py-1.5 text-right text-amber-400">
                                {formatOffset(c.offsetFromWindowMinutes)} window
                                edge
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Line>
                <Line label="Action not taken">
                  <Code tone="text-amber-300">{miss.action}</Code>
                  <span className="text-slate-500"> &mdash; owner {miss.owner}</span>
                </Line>
              </Panel>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
