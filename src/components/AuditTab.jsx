import { useState } from 'react';
import StatsHeader from './StatsHeader';
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

export default function AuditTab({ result }) {
  const [expandedId, setExpandedId] = useState(null);

  return (
    <div className="space-y-5">
      <StatsHeader stats={result.stats} />

      <section className="rounded-lg border border-slate-800 bg-slate-900/40">
        <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-slate-800 px-5 py-3">
          <h2 className="text-[13px] font-semibold tracking-wide text-slate-200 uppercase">
            Missed action report
          </h2>
          <p className="text-[12px] text-slate-500">
            Every interval that met a runbook trigger and threshold but has no
            corresponding execution in the log. Select a row for the full
            reconstruction.
          </p>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="text-[10px] tracking-wider text-slate-500 uppercase">
              <tr className="border-b border-slate-800">
                {COLUMNS.map((col, i) => (
                  <th
                    key={col.label || i}
                    className={`px-3 py-2.5 font-medium ${col.align ?? ''} ${
                      col.className ?? ''
                    } ${i === 0 ? 'pl-5' : ''} ${
                      i === COLUMNS.length - 1 ? 'pr-5' : ''
                    }`}
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

        {result.misses.length === 0 && (
          <p className="px-5 py-10 text-center text-[13px] text-slate-500">
            No missed actions detected in this window.
          </p>
        )}

        <footer className="border-t border-slate-800 px-5 py-3 text-[12px] leading-relaxed text-slate-500">
          Intervals are reconstructed from <code className="font-mono">timestamp</code>,
          the moment a state change actually occurred, not{' '}
          <code className="font-mono">ingestTimestamp</code>, the moment the
          platform learned of it. A miss is recorded when no execution of the
          runbook against the resource falls inside the interval widened by the
          tolerance window. Root-cause categorisation is out of scope for this
          pass.
        </footer>
      </section>
    </div>
  );
}
