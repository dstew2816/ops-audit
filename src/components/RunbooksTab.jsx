import RunbookCard from './RunbookCard';
import { firedCounts } from '../engine/detect';
import { platformStatus, uptimeRatio } from '../data/platformStatus';
import { formatTimestamp, minutesBetween, formatDuration } from '../engine/time';

const STATUS_TONE = {
  up: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  degraded: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  down: 'text-rose-400 border-rose-500/30 bg-rose-500/10',
};

export default function RunbooksTab({
  runbooks,
  executionLog,
  result,
  windowStart,
  windowEnd,
}) {
  const fired = firedCounts(executionLog, windowStart, windowEnd);

  const perRunbook = Object.fromEntries(
    runbooks.map((rb) => {
      const expected = result.expected.filter((e) => e.runbook.id === rb.id);
      const missed = expected.filter((e) => e.matched === null).length;
      return [rb.id, { expected: expected.length, logged: expected.length - missed, missed }];
    }),
  );

  const uptime = uptimeRatio(windowStart, windowEnd);
  const nonNominal = platformStatus.filter((w) => w.status !== 'up');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {runbooks.map((runbook) => (
          <RunbookCard
            key={runbook.id}
            runbook={runbook}
            fired={fired[runbook.id] ?? 0}
            {...perRunbook[runbook.id]}
          />
        ))}
      </div>

      <section className="rounded-lg border border-slate-800 bg-slate-900/40">
        <header className="flex items-baseline justify-between border-b border-slate-800 px-5 py-3">
          <h2 className="text-[13px] font-semibold tracking-wide text-slate-200 uppercase">
            Platform availability
          </h2>
          <span className="font-mono text-[12px] text-slate-400 tabular-nums">
            {(uptime * 100).toFixed(2)}% nominal across the window
          </span>
        </header>
        <p className="border-b border-slate-800 px-5 py-3 text-[13px] leading-relaxed text-slate-500">
          Recorded for context only. The platform performs no event replay on
          recovery, so any trigger condition that opened and closed inside a
          non-nominal window was never evaluated and is absent from the execution
          log.
        </p>
        <table className="w-full text-left text-[13px]">
          <thead className="text-[10px] tracking-wider text-slate-500 uppercase">
            <tr className="border-b border-slate-800">
              <th className="px-5 py-2 font-medium">Window</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Start</th>
              <th className="px-3 py-2 font-medium">End</th>
              <th className="px-3 py-2 font-medium">Duration</th>
              <th className="px-3 py-2 font-medium">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {nonNominal.map((w) => (
              <tr key={w.windowId}>
                <td className="px-5 py-2.5 font-mono text-[12px] text-slate-500">
                  {w.windowId}
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className={`rounded border px-1.5 py-0.5 font-mono text-[11px] ${STATUS_TONE[w.status]}`}
                  >
                    {w.status}
                  </span>
                </td>
                <td className="px-3 py-2.5 font-mono text-[12px] text-slate-300">
                  {formatTimestamp(w.start)}
                </td>
                <td className="px-3 py-2.5 font-mono text-[12px] text-slate-300">
                  {formatTimestamp(w.end)}
                </td>
                <td className="px-3 py-2.5 font-mono text-[12px] text-slate-300">
                  {formatDuration(minutesBetween(w.start, w.end))}
                </td>
                <td className="px-3 py-2.5 text-slate-500">{w.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
