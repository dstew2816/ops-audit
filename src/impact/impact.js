// Turns detected misses into labor hours and cost at risk, then ranks the fixes.
//
// EVERY NUMBER HERE IS AN ASSUMPTION, not a measurement. The data is synthetic,
// so there is no real labor log or cost ledger to read. The defaults are
// deliberately conservative (low rate, low probability that a miss causes real
// damage, bypassed cases discounted) and every one is editable on the Impact
// tab. The model is simple on purpose so each line can be explained out loud:
//
//   per miss:   hours      = manualHours[procedure] x weight
//               labor $    = hours x laborRate
//               risk $     = impactProbability x consequence[procedure] x weight
//               total $    = labor $ + risk $
//
//   weight is 1, or bypassWeight when the miss sat behind a recorded bypass
//   (for example a port in maintenance mode), because someone arguably meant
//   for the automation to stand down there.
//
// A FIX is one finding from the diagnosis: the misses that share a cause and
// one change that removes them. Fixes are ranked by what they stop, and also
// scored by payback: weeks of avoided cost needed to repay the effort to build
// the fix.

export const DEFAULT_ASSUMPTIONS = {
  laborRate: 45, // fully loaded $ per hour
  impactProbability: 0.25, // share of misses that cause real downstream cost
  bypassWeight: 0.5, // weight on misses behind a recorded bypass
  windowDays: 14, // length of the analysis window
  // per procedure: hours of manual work to find and recover one miss, and $
  // consequence if it does bite (expedite, rework, delay)
  procedures: {
    'ASOP-114': { manualHours: 1.0, consequence: 400 },
    'ASOP-118': { manualHours: 0.75, consequence: 300 },
    'ASOP-207': { manualHours: 1.5, consequence: 1200 },
    'ASOP-233': { manualHours: 1.0, consequence: 800 },
    'ASOP-341': { manualHours: 0.5, consequence: 150 },
    'ASOP-402': { manualHours: 0.75, consequence: 500 },
    'ASOP-455': { manualHours: 0.5, consequence: 100 },
  },
  // engineering hours to build and ship one fix, by kind of cause
  fixEffortHours: {
    infrastructure: 60, // build replay / backfill after an outage
    configuration: 3, // change a threshold, scope or bypass setting
    'logic-gap': 12,
    data: 8,
    'detector-error': 8,
    unexplained: 4, // investigation only
  },
};

/** Cost of one miss under the assumptions. */
export function costOfMiss(miss, a) {
  const p = a.procedures[miss.asopId];
  const weight = miss.bypassed ? a.bypassWeight : 1;
  const hours = p.manualHours * weight;
  const labor = hours * a.laborRate;
  const risk = a.impactProbability * p.consequence * weight;
  return { hours, labor, risk, total: labor + risk };
}

const add = (x, y) => ({
  hours: x.hours + y.hours,
  labor: x.labor + y.labor,
  risk: x.risk + y.risk,
  total: x.total + y.total,
});
const ZERO = { hours: 0, labor: 0, risk: 0, total: 0 };

/**
 * @param {{missId:string, asopId:string, bypassed:boolean}[]} misses
 * @param {{key:string, title:string, causeClass:string, missIds:string[]}[]} findings
 * @param {typeof DEFAULT_ASSUMPTIONS} a
 */
export function estimateImpact(misses, findings, a = DEFAULT_ASSUMPTIONS) {
  const byId = new Map(misses.map((m) => [m.missId, m]));
  const weeks = a.windowDays / 7;

  const perMiss = misses.map((m) => ({ ...m, ...costOfMiss(m, a) }));
  const costById = new Map(perMiss.map((m) => [m.missId, m]));

  const perProcedure = Object.keys(a.procedures).map((asopId) => {
    const rows = perMiss.filter((m) => m.asopId === asopId);
    return { asopId, misses: rows.length, ...rows.reduce(add, ZERO) };
  });

  const queue = findings.map((f) => {
    const members = f.missIds.map((id) => costById.get(id)).filter(Boolean);
    const cost = members.reduce(add, ZERO);
    const effortHours = a.fixEffortHours[f.causeClass] ?? 0;
    const effortCost = effortHours * a.laborRate;
    const costPerWeek = cost.total / weeks;
    return {
      key: f.key,
      title: f.title,
      causeClass: f.causeClass,
      misses: members.length,
      unmatched: f.missIds.filter((id) => !byId.has(id)),
      ...cost,
      effortHours,
      effortCost,
      // weeks of avoided cost needed to repay the effort; Infinity if nothing is at risk
      paybackWeeks: costPerWeek > 0 ? effortCost / costPerWeek : Infinity,
    };
  });

  const totals = perMiss.reduce(add, ZERO);
  return {
    perMiss,
    perProcedure,
    queue,
    totals: { ...totals, misses: perMiss.length },
    annualFactor: 365 / a.windowDays,
  };
}

export const SORTS = {
  total: { label: 'Cost at risk', key: (q) => -q.total },
  hours: { label: 'Labor hours', key: (q) => -q.hours },
  payback: { label: 'Fastest payback', key: (q) => q.paybackWeeks },
};

export const rankQueue = (queue, sort = 'total') =>
  queue.slice().sort((x, y) => SORTS[sort].key(x) - SORTS[sort].key(y));
