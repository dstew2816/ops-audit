import { useMemo, useState } from 'react';
import { runbooks } from './data/runbooks';
import { events, ANALYSIS_END, WINDOW_START } from './data/events';
import { executionLog } from './data/executionLog';
import { detect } from './engine/detect';
import TabBar from './components/TabBar';
import RunbooksTab from './components/RunbooksTab';
import AuditTab from './components/AuditTab';
import GenerateTab from './components/GenerateTab';
import { formatTimestamp } from './engine/time';

const TABS = [
  { id: 'runbooks', label: 'Runbooks' },
  { id: 'audit', label: 'Audit' },
  { id: 'generate', label: 'Generate' },
];

export default function App() {
  const [tab, setTab] = useState('runbooks');

  const result = useMemo(
    () =>
      detect({
        events,
        runbooks,
        executionLog,
        analysisEnd: ANALYSIS_END,
      }),
    [],
  );

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-800 bg-slate-900/40">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-end justify-between gap-4 px-6 pt-6 pb-0">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-100">
              Audit Layer
            </h1>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-slate-500">
              Independent reconciliation pass over ITSM runbook automation. The
              platform is event-driven with no historical replay, so a condition
              that passes while it is down or delayed leaves no trace in the
              system that failed. This pass reconstructs resource state from raw
              events and reports the actions that should have fired but did not.
            </p>
          </div>
          <dl className="flex gap-6 pb-1 text-[11px] tracking-wide text-slate-500 uppercase">
            <div>
              <dt>Analysis window</dt>
              <dd className="mt-0.5 font-mono text-[12px] tracking-normal text-slate-300 normal-case">
                {formatTimestamp(WINDOW_START)} &rarr; {formatTimestamp(ANALYSIS_END)}
              </dd>
            </div>
            <div>
              <dt>Events ingested</dt>
              <dd className="mt-0.5 font-mono text-[12px] tracking-normal text-slate-300 normal-case">
                {result.stats.eventsIngested.toLocaleString()} across{' '}
                {result.stats.resourcesObserved} resources
              </dd>
            </div>
          </dl>
        </div>
        <div className="mx-auto max-w-[1400px] px-6">
          <TabBar
            tabs={TABS}
            active={tab}
            onChange={setTab}
            counts={{ runbooks: runbooks.length, audit: result.stats.missesFound }}
          />
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-6 py-6">
        {tab === 'runbooks' && (
          <RunbooksTab
            runbooks={runbooks}
            executionLog={executionLog}
            result={result}
            windowStart={WINDOW_START}
            windowEnd={ANALYSIS_END}
          />
        )}
        {tab === 'audit' && <AuditTab result={result} />}
        {tab === 'generate' && <GenerateTab />}
      </main>
    </div>
  );
}
