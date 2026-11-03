// Shared layout pieces for the deeper views: a numbered part heading, and a
// collapsible block for the detail most readers can skip.

export function Part({ n, title, lead, children }) {
  return (
    <section className="border-t border-slate-800 pt-10 first:border-t-0 first:pt-0">
      <p className="eyebrow">{n}</p>
      <h2 className="mt-1 text-[clamp(1.5rem,3.2vw,1.9rem)] leading-tight font-semibold tracking-tight text-slate-100">{title}</h2>
      {lead && <p className="mt-3 max-w-3xl text-[16px] leading-[1.7] text-slate-300">{lead}</p>}
      <div className="mt-8">{children}</div>
    </section>
  );
}

export function More({ label, children }) {
  return (
    <details className="more rounded border border-slate-800 bg-slate-900 px-5 py-4">
      <summary className="text-[14px] font-medium text-slate-100">{label}</summary>
      <div className="mt-6 space-y-12">{children}</div>
    </details>
  );
}
