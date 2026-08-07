function Stat({ label, value, sub, tone = 'text-slate-100', wide = false }) {
  return (
    <div
      className={`px-5 py-4 ${wide ? 'col-span-2 sm:col-span-1' : ''}`}
    >
      <div className={`font-mono text-2xl leading-none tabular-nums ${tone}`}>
        {value}
      </div>
      <div className="mt-2 text-[10px] font-medium tracking-wider text-slate-500 uppercase">
        {label}
      </div>
      {sub && <div className="mt-1 text-[11px] text-slate-600">{sub}</div>}
    </div>
  );
}

export default function StatsHeader({ stats }) {
  return (
    <div className="grid grid-cols-2 divide-slate-800 rounded-lg border border-slate-800 bg-slate-900/40 sm:grid-cols-5 sm:divide-x">
      <Stat
        label="Intervals evaluated"
        value={stats.intervalsEvaluated.toLocaleString()}
        sub={`${stats.intervalsReconstructed} intervals x ${
          stats.intervalsEvaluated / stats.intervalsReconstructed
        } runbooks`}
      />
      <Stat
        label="Actions expected"
        value={stats.actionsExpected}
        sub="matched trigger and threshold"
      />
      <Stat
        label="Actions logged"
        value={stats.actionsLogged}
        tone="text-emerald-400"
        sub={`of ${stats.executionsRecorded} executions recorded`}
      />
      <Stat
        label="Misses found"
        value={stats.missesFound}
        tone="text-amber-400"
        sub="no execution within tolerance"
      />
      <Stat
        label="Miss rate"
        value={`${(stats.missRate * 100).toFixed(1)}%`}
        tone="text-amber-400"
        sub="misses / actions expected"
      />
    </div>
  );
}
