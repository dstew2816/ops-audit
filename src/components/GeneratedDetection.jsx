import { useState } from 'react';
import MissRow from './MissRow';

const COLUMNS = [
  { label: '', className: 'w-8' },
  { label: 'Resource' },
  { label: 'Type' },
  { label: 'Runbook' },
  { label: 'State' },
  { label: 'Interval start' },
  { label: 'Interval end' },
  { label: 'Duration', align: 'text-right' },
  { label: 'Threshold', align: 'text-right' },
  { label: 'Signals', align: 'text-right' },
];

function Delta({ value }) {
  if (value === 0) {
    return <span className="text-slate-500">no change</span>;
  }
  const tone = value > 0 ? 'text-amber-400' : 'text-emerald-400';
  return (
    <span className={tone}>
      {value > 0 ? '+' : ''}
      {value}
    </span>
  );
}

function Stat({ label, value, sub, tone = 'text-slate-100' }) {
  return (
    <div className="px-5 py-4">
      <div className={`font-mono text-2xl leading-none tabular-nums ${tone}`}>{value}</div>
      <div className="mt-2 text-[10px] font-medium tracking-wider text-slate-500 uppercase">
        {label}
      </div>
      {sub && <div className="mt-1 text-[11px] text-slate-600">{sub}</div>}
    </div>
  );
}

/**
 * The detection engine run against the generated definition, alongside the
 * same run against the runbook as configured on the platform. Both are scored
 * over the identical event stream and execution log, so any difference in the
 * miss set is attributable to the definition and nothing else.
 */
export default function GeneratedDetection({ runbook, result, baseline, baselineRunbook }) {
  const [expandedId, setExpandedId] = useState(null);

  const delta = result.stats.missesFound - baseline.stats.missesFound;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 divide-slate-800 rounded-lg border border-slate-800 bg-slate-900/40 sm:grid-cols-4 sm:divide-x">
        <Stat
          label="Actions expected"
          value={result.stats.actionsExpected}
          sub={`${baseline.stats.actionsExpected} as configured`}
        />
        <Stat
          label="Actions logged"
          value={result.stats.actionsLogged}
          tone="text-emerald-400"
          sub={`${baseline.stats.actionsLogged} as configured`}
        />
        <Stat
          label="Misses found"
          value={result.stats.missesFound}
          tone={result.stats.missesFound ? 'text-amber-400' : 'text-slate-500'}
          sub={`${baseline.stats.missesFound} as configured`}
        />
        <Stat
          label="Miss rate"
          value={`${(result.stats.missRate * 100).toFixed(1)}%`}
          tone={result.stats.missesFound ? 'text-amber-400' : 'text-slate-500'}
          sub={`${(baseline.stats.missRate * 100).toFixed(1)}% as configured`}
        />
      </div>

      <p className="rounded-lg border border-slate-800 bg-slate-900/40 px-5 py-3 text-[13px] leading-relaxed text-slate-400">
        Evaluated as <span className="font-mono text-slate-300">{runbook.id}</span> against the
        same {result.stats.eventsIngested.toLocaleString()} events and execution log as the main
        audit. The anti-join matches on{' '}
        <code className="font-mono text-[12px] text-slate-400">runbookId + resourceId</code>, so
        the generated definition has to carry the ID of the runbook its documentation describes —
        under a fresh ID it would match no executions at all and report every qualifying interval
        as a miss.{' '}
        <span className="text-slate-300">
          Against {baselineRunbook.name} as configured: <Delta value={delta} />
          {delta !== 0 ? ' misses.' : '.'}
        </span>
      </p>

      <section className="rounded-lg border border-slate-800 bg-slate-900/40">
        <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-slate-800 px-5 py-3">
          <h3 className="text-[13px] font-semibold tracking-wide text-slate-200 uppercase">
            Misses under the generated definition
          </h3>
          <p className="text-[12px] text-slate-500">
            Select a row for the full reconstruction.
          </p>
        </header>

        {result.misses.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="text-[10px] tracking-wider text-slate-500 uppercase">
                <tr className="border-b border-slate-800">
                  {COLUMNS.map((col, i) => (
                    <th
                      key={col.label || i}
                      className={`px-3 py-2.5 font-medium ${col.align ?? ''} ${
                        col.className ?? ''
                      } ${i === 0 ? 'pl-5' : ''} ${i === COLUMNS.length - 1 ? 'pr-5' : ''}`}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.misses.map((miss) => (
                  <MissRow
                    key={miss.id}
                    miss={miss}
                    expanded={expandedId === miss.id}
                    onToggle={() =>
                      setExpandedId((current) => (current === miss.id ? null : miss.id))
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-5 py-10 text-center text-[13px] text-slate-500">
            This definition matched no intervals that went unactioned. Either nothing met its
            trigger and threshold, or everything that did was covered by a logged execution.
          </p>
        )}
      </section>
    </div>
  );
}
