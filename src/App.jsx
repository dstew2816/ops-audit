// App shell: the header and the tab navigation for every view.
import { useState } from 'react';
import TabBar from './components/TabBar';
import OverviewTab from './components/OverviewTab';
import AuditTab from './components/AuditTab';
import NetworkTab from './components/NetworkTab';
import SpcTab from './components/SpcTab';
import ImpactTab from './components/ImpactTab';
import MlTab from './components/MlTab';
import RealDataTab from './components/RealDataTab';
import AiTab from './components/AiTab';
import { formatTimestamp } from './engine/time';
import { SEED_ROWS, WINDOW_START, ANALYSIS_END } from './db/seed/index.js';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'audit', label: 'Audit' },
  { id: 'network', label: 'Network' },
  { id: 'spc', label: 'SPC' },
  { id: 'impact', label: 'Impact' },
  { id: 'ml', label: 'ML' },
  { id: 'real', label: 'Real Data' },
  { id: 'ai', label: 'AI Layers' },
];

const TOTAL_ROWS = Object.values(SEED_ROWS).reduce((sum, rows) => sum + rows.length, 0);

export default function App() {
  const [tab, setTab] = useState('overview');

  const go = (id) => {
    setTab(id);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-800 bg-slate-900/40">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-end justify-between gap-4 px-6 pt-6 pb-0">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-100">OpsAudit</h1>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-slate-500">
              An independent audit of operations automation: what it missed, what that costs, and what to fix first.
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
              <dt>Synthetic rows</dt>
              <dd className="mt-0.5 font-mono text-[12px] tracking-normal text-slate-300 normal-case">
                {TOTAL_ROWS.toLocaleString()} across {Object.keys(SEED_ROWS).length} tables
              </dd>
            </div>
          </dl>
        </div>
        <div className="mx-auto max-w-[1400px] overflow-x-auto px-6">
          <TabBar tabs={TABS} active={tab} onChange={go} />
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-6 py-6">
        {tab === 'overview' && <OverviewTab onNavigate={go} />}
        {tab === 'audit' && <AuditTab />}
        {tab === 'network' && <NetworkTab />}
        {tab === 'spc' && <SpcTab />}
        {tab === 'impact' && <ImpactTab />}
        {tab === 'ml' && <MlTab />}
        {tab === 'real' && <RealDataTab />}
        {tab === 'ai' && <AiTab />}
      </main>
    </div>
  );
}
