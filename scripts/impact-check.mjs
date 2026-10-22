// Verifies the impact model: every detected miss is accounted for exactly once,
// the totals reconcile three different ways, and the maths responds to its
// assumptions in the right direction.
//
//   npm run impact:check

import { createRequire } from 'node:module';
import path from 'node:path';
import initSqlJs from 'sql.js';
import { buildDatabase } from '../src/db/build.js';
import { EXPECTED_FINDINGS } from '../src/db/expected-findings.js';
import { loadMissRecords } from '../src/impact/misses.js';
import { DEFAULT_ASSUMPTIONS, estimateImpact, rankQueue } from '../src/impact/impact.js';

const SQL_JS_DIR = path.dirname(createRequire(import.meta.url).resolve('sql.js'));
let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? '\x1b[32mok\x1b[0m  ' : '\x1b[31mFAIL\x1b[0m'} ${label.padEnd(58)} ${detail}`);
};
const near = (a, b) => Math.abs(a - b) < 1e-6;
const clone = (o) => JSON.parse(JSON.stringify(o));

const SQL = await initSqlJs({ locateFile: (f) => path.join(SQL_JS_DIR, f) });
const misses = loadMissRecords(buildDatabase(SQL));
const run = (a = DEFAULT_ASSUMPTIONS) => estimateImpact(misses, EXPECTED_FINDINGS, a);
const base = run();

console.log('\nCoverage');
check('24 misses detected', misses.length === 24, String(misses.length));
const inFindings = EXPECTED_FINDINGS.flatMap((f) => f.missIds);
check('every miss is in exactly one fix', misses.every((m) => inFindings.filter((id) => id === m.missId).length === 1));
check('no fix references a miss that was not detected', base.queue.every((q) => q.unmatched.length === 0));

console.log('\nTotals reconcile');
const sum = (rows, k) => rows.reduce((s, r) => s + r[k], 0);
check('per-miss total = per-procedure total', near(sum(base.perMiss, 'total'), sum(base.perProcedure, 'total')));
check('per-miss total = fix queue total', near(sum(base.perMiss, 'total'), sum(base.queue, 'total')));
check('hours reconcile the same way', near(sum(base.perMiss, 'hours'), sum(base.queue, 'hours')));
check('labor + risk = total', near(base.totals.labor + base.totals.risk, base.totals.total));

console.log('\nThe model responds to its assumptions');
{
  const doubled = clone(DEFAULT_ASSUMPTIONS);
  doubled.laborRate *= 2;
  check('doubling the labor rate doubles labor cost', near(run(doubled).totals.labor, base.totals.labor * 2));
  check('...and leaves hours unchanged', near(run(doubled).totals.hours, base.totals.hours));
  const zero = clone(DEFAULT_ASSUMPTIONS);
  zero.impactProbability = 0;
  check('probability 0 removes all consequence risk', run(zero).totals.risk === 0);
  const full = clone(DEFAULT_ASSUMPTIONS);
  full.bypassWeight = 1;
  const none = clone(DEFAULT_ASSUMPTIONS);
  none.bypassWeight = 0;
  check(
    'counting bypassed misses fully costs more than discounting',
    run(full).totals.total > base.totals.total && base.totals.total > run(none).totals.total,
  );
  const bypassed = misses.filter((m) => m.bypassed).length;
  console.log(`  note  ${bypassed} of ${misses.length} misses sit behind a recorded bypass`);
}

console.log('\nRanking');
{
  const ranked = rankQueue(base.queue, 'total');
  check('queue is sorted by cost at risk, descending', ranked.every((q, i) => i === 0 || ranked[i - 1].total >= q.total));
  const byPayback = rankQueue(base.queue, 'payback');
  check(
    'payback sort puts the fastest repayment first',
    byPayback.every((q, i) => i === 0 || byPayback[i - 1].paybackWeeks <= q.paybackWeeks),
  );
  console.log(`  note  top by cost: ${ranked[0].key} ($${ranked[0].total.toFixed(0)}, ${ranked[0].misses} misses)`);
  console.log(`  note  fastest payback: ${byPayback[0].key} (${byPayback[0].paybackWeeks.toFixed(1)} weeks)`);
  console.log(
    `  note  window total: ${base.totals.hours.toFixed(1)} labor hours, $${base.totals.total.toFixed(0)} at risk ` +
      `($${(base.totals.total * base.annualFactor).toFixed(0)} annualised)`,
  );
}

console.log(`\n${failures === 0 ? '\x1b[32mAll checks passed.\x1b[0m' : `\x1b[31m${failures} check(s) failed.\x1b[0m`}\n`);
process.exit(failures === 0 ? 0 : 1);
