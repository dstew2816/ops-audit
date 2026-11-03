// App shell: the top bar, a front page that carries the whole story, and three deeper views.
import { useEffect, useState } from 'react';
import TabBar from './components/TabBar';
import OverviewTab from './components/OverviewTab';
import AuditTab from './components/AuditTab';
import NetworkTab from './components/NetworkTab';
import SpcTab from './components/SpcTab';
import ImpactTab from './components/ImpactTab';
import MlTab from './components/MlTab';
import RealDataTab from './components/RealDataTab';
import AiTab from './components/AiTab';
import { Part } from './components/More';

const TABS = [
  { id: 'overview', label: 'Summary' },
  { id: 'audit', label: 'Audit and cost' },
  { id: 'models', label: 'Monitoring and models' },
  { id: 'real', label: 'Real-data check' },
];

// Pages that used to be their own tabs now live inside one of the four views.
const ROUTE = {
  overview: 'overview',
  audit: 'audit',
  impact: 'audit',
  network: 'audit',
  spc: 'models',
  ml: 'models',
  ai: 'models',
  models: 'models',
  real: 'real',
};

const PORTFOLIO = 'https://dstew2816.github.io/';

function Stack({ children }) {
  return <div className="space-y-16">{children}</div>;
}

function useTheme() {
  const read = () =>
    document.documentElement.dataset.theme ||
    (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  const [theme, setTheme] = useState(read);
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch (e) {
      /* storage can be blocked; the choice just will not persist */
    }
    setTheme(next);
  };
  return [theme, toggle];
}

export default function App() {
  const [tab, setTab] = useState('overview');
  const [theme, toggleTheme] = useTheme();

  const go = (id) => {
    setTab(ROUTE[id] ?? 'overview');
    window.scrollTo({ top: 0 });
  };

  useEffect(() => {
    document.title = 'OpsAudit | David Stewart';
  }, []);

  return (
    <div className="min-h-screen">
      <nav className="sticky top-3 z-20 mx-auto mt-3 max-w-[68rem] px-5" aria-label="Main">
        <div className="flex items-center justify-between gap-4 rounded-full border border-slate-800 bg-slate-900 py-2 pr-2 pl-5 shadow-sm">
          <span className="font-semibold text-slate-100">
            OpsAudit <span className="hidden font-normal text-slate-500 sm:inline">&middot; a project by David Stewart</span>
          </span>
          <div className="flex items-center gap-5 text-[14px] text-slate-500">
            <a className="hidden hover:text-slate-100 sm:inline" href={PORTFOLIO}>Portfolio</a>
            <a className="hidden hover:text-slate-100 sm:inline" href={`${PORTFOLIO}projects/opsaudit.html`}>Case study</a>
            <a className="hidden hover:text-slate-100 sm:inline" href="https://github.com/dstew2816/ops-audit" target="_blank" rel="noreferrer">Source</a>
            <button
              type="button"
              role="switch"
              aria-checked={theme === 'dark'}
              onClick={toggleTheme}
              className="flex cursor-pointer items-center gap-2 px-1 text-[13px] text-slate-500"
            >
              {theme === 'dark' ? 'Dark' : 'Light'}
              <span className="relative h-[1.35rem] w-[2.4rem] rounded-full border border-slate-700 bg-slate-800">
                <span
                  className={`absolute top-[2px] left-[2px] h-[calc(1.35rem-6px)] w-[calc(1.35rem-6px)] rounded-full bg-slate-100 transition-transform ${
                    theme === 'dark' ? 'translate-x-[1.05rem]' : ''
                  }`}
                />
              </span>
            </button>
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-[68rem] px-5">
        <div className="mt-8 overflow-x-auto">
          <TabBar tabs={TABS} active={tab} onChange={go} />
        </div>

        <main className="py-8">
          {tab === 'overview' && <OverviewTab onNavigate={go} tabs={TABS} />}
          {tab === 'audit' && (
            <Stack>
              <Part
                n="01 · The audit"
                title="Which cases each procedure missed"
                lead="Seven SQL queries, one per automated procedure, rebuild every case that should have triggered it and look for that case in the procedure's own log. The database is SQLite running in your browser, so every number below is computed when the page loads."
              >
                <AuditTab />
              </Part>
              <Part
                n="02 · Cost"
                title="What the misses cost, and which fix comes first"
                lead="Each miss becomes labor hours and cost at risk, and misses that share a cause are grouped into one fix. The inputs are deliberately low assumptions, and you can edit them."
              >
                <ImpactTab />
              </Part>
              <Part
                n="03 · Station network"
                title="The route the batches take"
                lead="Batches move through six stages, with two parallel lanes at the Process stage. This is the data the control charts on the next tab are built from."
              >
                <NetworkTab />
              </Part>
            </Stack>
          )}
          {tab === 'models' && (
            <Stack>
              <Part n="01 · Monitoring" title="Statistical process control">
                <SpcTab />
              </Part>
              <Part n="02 · Machine learning" title="Classifying procedure definitions">
                <MlTab />
              </Part>
              <Part n="03 · AI layers" title="Writing detection queries and grouping misses with Claude">
                <AiTab />
              </Part>
            </Stack>
          )}
          {tab === 'real' && <RealDataTab />}
        </main>
      </div>
    </div>
  );
}
