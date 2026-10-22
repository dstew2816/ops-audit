// Tab navigation bar with an optional count badge on each tab.
export default function TabBar({ tabs, active, onChange, counts = {} }) {
  return (
    <nav className="-mb-px flex gap-1" aria-label="Sections">
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            aria-current={isActive ? 'page' : undefined}
            className={[
              'flex items-center gap-2 border-b-2 px-4 py-2.5 text-[13px] font-medium transition-colors',
              isActive
                ? 'border-sky-400 text-slate-100'
                : 'border-transparent text-slate-500 hover:border-slate-700 hover:text-slate-300',
            ].join(' ')}
          >
            {tab.label}
            {counts[tab.id] != null && (
              <span
                className={[
                  'rounded px-1.5 py-0.5 font-mono text-[11px]',
                  isActive
                    ? 'bg-slate-700/70 text-slate-200'
                    : 'bg-slate-800/70 text-slate-500',
                ].join(' ')}
              >
                {counts[tab.id]}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
