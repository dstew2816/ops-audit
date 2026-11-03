// Section switcher, styled as the pill tabs on the portfolio.
export default function TabBar({ tabs, active, onChange }) {
  return (
    <nav className="flex gap-1.5" aria-label="Sections">
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            aria-current={isActive ? 'page' : undefined}
            className={[
              'cursor-pointer rounded-full px-4 py-2 text-[14px] font-medium whitespace-nowrap transition-colors',
              isActive ? 'bg-slate-100 text-slate-950' : 'bg-slate-900 text-slate-500 hover:text-slate-100',
            ].join(' ')}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
