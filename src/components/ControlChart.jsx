// One control chart as inline SVG: points, centre line, limits, sigma zones and alerts.
// Shared by the SPC tab and the home page.

const fmt = (value, digits = 2) => Number(value).toFixed(digits);

export default function ControlChart({ title, values, cl, ucl, lcl, sigma, hits = [], baseline = null, labels = [] }) {
  const W = 720;
  const H = 230;
  const pad = { l: 48, r: 16, t: 14, b: 26 };
  const flagged = new Set(hits.map((h) => h.index));

  const lo = Math.min(...values, lcl) - (ucl - lcl) * 0.08;
  const hi = Math.max(...values, ucl) + (ucl - lcl) * 0.08;
  const x = (i) => pad.l + (i / Math.max(values.length - 1, 1)) * (W - pad.l - pad.r);
  const y = (v) => pad.t + ((hi - v) / (hi - lo)) * (H - pad.t - pad.b);

  const zones = sigma ? [1, 2].flatMap((k) => [cl + k * sigma, cl - k * sigma]) : [];
  const path = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  return (
    <figure className="rounded border border-slate-800 bg-slate-900 p-3">
      <figcaption className="mb-1 flex items-baseline justify-between text-[12px]">
        <span className="font-medium text-slate-200">{title}</span>
        <span className="font-mono text-[11px] text-slate-500">
          UCL {fmt(ucl)} · CL {fmt(cl)} · LCL {fmt(lcl)}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={title}>
        {baseline !== null && (
          <g>
            <line x1={x(baseline - 0.5)} x2={x(baseline - 0.5)} y1={pad.t} y2={H - pad.b} className="stroke-slate-600" strokeDasharray="2 3" />
            <text x={x(baseline - 0.5) + 4} y={pad.t + 9} className="fill-slate-500" fontSize="9">
              limits set from first {baseline} subgroups
            </text>
          </g>
        )}
        {zones.map((v) => (
          <line key={v} x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="stroke-slate-800" />
        ))}
        {[ucl, lcl].map((v, i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="stroke-rose-400/70" strokeDasharray="5 4" />
            <text x={pad.l - 6} y={y(v) + 3} textAnchor="end" className="fill-rose-300" fontSize="10">
              {i === 0 ? 'UCL' : 'LCL'}
            </text>
          </g>
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={y(cl)} y2={y(cl)} className="stroke-slate-500" />
        <text x={pad.l - 6} y={y(cl) + 3} textAnchor="end" className="fill-slate-400" fontSize="10">CL</text>
        <path d={path} fill="none" className="stroke-sky-400/80" strokeWidth="1.5" />
        {values.map((v, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(v)}
            r={flagged.has(i) ? 4.5 : 2.5}
            className={flagged.has(i) ? 'fill-rose-400 stroke-slate-950' : 'fill-sky-300'}
          >
            <title>{`${labels[i] ?? `#${i}`}: ${fmt(v)}${flagged.has(i) ? ': out of control' : ''}`}</title>
          </circle>
        ))}
        {[0, Math.floor((values.length - 1) / 2), values.length - 1].map((i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="fill-slate-500" fontSize="10">
            {i}
          </text>
        ))}
      </svg>
    </figure>
  );
}
