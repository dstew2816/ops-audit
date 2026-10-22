// Verification harness for the SQL data layer.
//
//   npm run db:check
//   npm run db:check -- --print-sql     also dump all seven baseline queries
//
// Loads the same schema and the same seed rows the browser loads, under plain
// Node, and checks:
//
//   1. JSON1 is present, and json_type() can tell a JSON null from a missing key.
//   2. Every table is populated and every CHECK constraint held.
//   3. All seven hand-written baselines in src/db/baselines.js run, and each
//      one's qualifying / logged / missed counts match the planted ground truth.
//   4. No baseline returns zero misses. A detection query that finds nothing
//      proves nothing, so that is a hard failure rather than a clean run.
//   5. The query runner's guards behave.

import { createRequire } from 'node:module';
import path from 'node:path';
import initSqlJs from 'sql.js';
import { buildDatabase } from '../src/db/build.js';
import { runQuery, queryValue, listTables } from '../src/db/query.js';
import { BASELINES, baselineParams } from '../src/db/baselines.js';
// The same predicates src/engine/generate-sql.js applies to generated SQL and
// src/engine/score.js applies when diffing it. Shared so a rule cannot be
// enforced on one side and quietly relaxed on the other.
import {
  ANTI_JOIN_FILTER,
  attributesBypass,
  bypassColumn,
  isAntiJoinFilter,
  outerFilter,
} from '../src/db/house-rules.js';
import { SEED_ROWS, allCandidates, ANALYSIS_END } from '../src/db/seed/index.js';

const require = createRequire(import.meta.url);
const SQL_JS_DIR = path.dirname(require.resolve('sql.js'));

const END = new Date(ANALYSIS_END).toISOString().replace('.000Z', 'Z');
const PRINT_SQL = process.argv.includes('--print-sql');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

let failures = 0;

const pad = (value, width) => String(value).padEnd(width);
const padStart = (value, width) => String(value).padStart(width);

function assert(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  const mark = ok ? `${GREEN}ok${RESET}` : `${RED}FAIL${RESET}`;
  const detail = ok ? `${actual}` : `${actual} ${DIM}(expected ${expected})${RESET}`;
  console.log(`  ${mark}  ${pad(label, 46)} ${detail}`);
}

function fail(label, detail) {
  failures += 1;
  console.log(`  ${RED}FAIL${RESET}  ${pad(label, 46)} ${detail}`);
}

// ---------------------------------------------------------------------------

async function main() {
  const SQL = await initSqlJs({ locateFile: (file) => path.join(SQL_JS_DIR, file) });
  const db = buildDatabase(SQL);

  console.log(`\n${DIM}SQLite ${queryValue(db, 'SELECT sqlite_version()')} via sql.js${RESET}\n`);

  // 1. JSON1 --------------------------------------------------------------
  console.log('JSON1');
  assert('json_extract available', queryValue(db, `SELECT json_extract('{"a":7}', '$.a')`), 7);
  assert(
    'json_type sees an explicit null',
    queryValue(db, `SELECT json_type('{"dept_code":null}', '$.dept_code')`),
    'null',
  );
  assert(
    'json_type sees a missing key as NULL',
    queryValue(db, `SELECT json_type('{"other":1}', '$.dept_code')`),
    null,
  );

  // 2. Tables -------------------------------------------------------------
  console.log('\nTables');
  const tables = listTables(db);
  assert('tables created', tables.length, Object.keys(SEED_ROWS).length);
  for (const table of tables) {
    assert(table, queryValue(db, `SELECT COUNT(*) FROM ${table}`), SEED_ROWS[table].length);
  }

  const blanks = queryValue(
    db,
    `SELECT COUNT(*) FROM hold_records WHERE dept_code IS NOT NULL AND TRIM(dept_code) = ''`,
  );
  console.log(
    `  ${DIM}note${RESET}  ${pad('hold_records blank dept_code', 46)} ${blanks} ${DIM}(invisible to IS NULL, by design)${RESET}`,
  );

  // 3 + 4. The baselines --------------------------------------------------
  console.log(`\n${BOLD}Baseline detection${RESET} ${DIM}src/db/baselines.js${RESET}`);
  console.log(
    `        ${pad('asop', 11)}${pad('shape', 25)}` +
      `${padStart('qual', 5)}${padStart('logged', 7)}${padStart('missed', 7)}` +
      `${padStart('bypassed', 10)}${padStart('unbypassed', 12)}${padStart('planted', 9)}`,
  );

  let totalQualifying = 0;
  let totalLogged = 0;
  let totalMissed = 0;
  let totalBypassed = 0;
  let totalUnbypassed = 0;
  const emptyBaselines = [];

  for (const baseline of BASELINES) {
    const params = baselineParams(baseline, { analysisEnd: END });
    const bind = baseline.params.length > 0 ? { params } : {};

    const coverage = runQuery(db, baseline.coverageSql, bind);
    const misses = runQuery(db, baseline.sql, bind);

    if (!coverage.ok || !misses.ok) {
      fail(baseline.asopId, coverage.error ?? misses.error);
      continue;
    }

    const { qualifying, logged, missed } = coverage.rows[0];
    const planted = allCandidates.filter((c) => c.asopId === baseline.asopId);
    const plantedMissed = planted.filter((c) => !c.handled).length;

    // A bypassed miss is still a miss. These are counted apart from the rest
    // so the split is visible, never to filter one of them out.
    const bypassed = misses.rows.filter((row) => row.bypass !== null).length;
    const unbypassed = misses.rows.filter((row) => row.bypass === null).length;

    totalQualifying += qualifying;
    totalLogged += logged;
    totalMissed += missed;
    totalBypassed += bypassed;
    totalUnbypassed += unbypassed;

    // The miss query and the coverage query must agree, both must match what
    // was planted, and a baseline that finds nothing has proved nothing.
    const agrees = misses.rowCount === missed;
    const matchesPlanted = qualifying === planted.length && missed === plantedMissed;
    // No bypassed row may have gone missing between the two.
    const nothingSuppressed = bypassed + unbypassed === missed;
    if (missed === 0) emptyBaselines.push(baseline.asopId);

    const ok = agrees && matchesPlanted && nothingSuppressed && missed > 0;
    if (!ok) failures += 1;

    const mark = ok ? `${GREEN}ok${RESET}  ` : `${RED}FAIL${RESET}`;
    console.log(
      `  ${mark}  ${pad(baseline.asopId, 11)}${pad(baseline.shape, 25)}` +
        `${padStart(qualifying, 5)}${padStart(logged, 7)}${padStart(missed, 7)}` +
        `${padStart(baseline.bypasses.length === 0 ? '-' : bypassed, 10)}` +
        `${padStart(unbypassed, 12)}${padStart(plantedMissed, 9)}`,
    );

    if (!agrees) {
      console.log(
        `        ${RED}miss query returned ${misses.rowCount}, coverage says ${missed}${RESET}`,
      );
    }
    if (!matchesPlanted) {
      console.log(
        `        ${RED}planted ${planted.length} qualifying / ${plantedMissed} missed${RESET}`,
      );
    }
    if (!nothingSuppressed) {
      console.log(
        `        ${RED}${bypassed} bypassed + ${unbypassed} unbypassed != ${missed} missed${RESET}`,
      );
    }
  }

  if (emptyBaselines.length > 0) {
    console.log(
      `\n  ${RED}${BOLD}A baseline that finds no misses proves nothing:${RESET} ` +
        `${RED}${emptyBaselines.join(', ')}${RESET}`,
    );
  }

  // 5. Bypasses attribute, they never suppress ----------------------------
  //
  // A candidate that qualified and was bypassed is still a real miss. The
  // bypass explains why nothing fired; it does not erase the gap. Suppressing
  // those rows would make this pass inherit the blind spot of the system it is
  // auditing, so the property is enforced here rather than left to care.
  console.log('\nBypass attribution');
  for (const baseline of BASELINES) {
    // The outer filter must be the anti-join and nothing else. Anything more
    // would be dropping qualifying rows after the fact.
    const outerWhere = outerFilter(baseline.sql);
    if (!isAntiJoinFilter(outerWhere)) {
      fail(`${baseline.asopId} outer filter`, `${RED}${outerWhere ?? `no ${ANTI_JOIN_FILTER}`}${RESET}`);
      continue;
    }

    // A bypass declared in the metadata must actually be attributed in the
    // SELECT list, or it is documentation of something the query doesn't do.
    const unattributed = baseline.bypasses.filter(
      (bypass) => !attributesBypass(baseline.sql, bypassColumn(bypass.clause)),
    );
    if (unattributed.length > 0) {
      fail(
        `${baseline.asopId} bypass attribution`,
        `not in the SELECT list: ${unattributed.map((b) => b.name).join(', ')}`,
      );
      continue;
    }

    const declared = baseline.bypasses.length;
    console.log(
      `  ${GREEN}ok${RESET}  ${pad(`${baseline.asopId} attributes, does not suppress`, 46)} ` +
        `${DIM}${declared === 0 ? 'no bypasses declared' : `${declared} declared, filter is the anti-join only`}${RESET}`,
    );
  }

  // 5b. Station routes ----------------------------------------------------
  console.log('\nStation routes');
  assert('batches with a full route', queryValue(db, `SELECT COUNT(*) FROM (SELECT batch_id FROM station_visits GROUP BY batch_id HAVING COUNT(*) = 6)`), 24);
  assert('handoffs (5 per batch)', queryValue(db, 'SELECT COUNT(*) FROM station_handoffs'), 120);
  assert('visits where departed < arrived', queryValue(db, 'SELECT COUNT(*) FROM station_visits WHERE departed_at < arrived_at'), 0);
  assert('handoffs that arrive before they depart', queryValue(db, 'SELECT COUNT(*) FROM station_handoffs WHERE arrived_at < departed_at'), 0);
  assert(
    'handoffs that skip or reverse a stage',
    queryValue(db, `SELECT COUNT(*) FROM station_handoffs h JOIN stations f ON f.station_id = h.from_station JOIN stations t ON t.station_id = h.to_station WHERE t.seq <> f.seq + 1`),
    0,
  );
  assert('visits outside the analysis window', queryValue(db, `SELECT COUNT(*) FROM station_visits WHERE departed_at > '${END}'`), 0);
  assert('parallel-lane stations at seq 3', queryValue(db, 'SELECT COUNT(*) FROM stations WHERE seq = 3'), 2);

  // 6. Totals -------------------------------------------------------------
  const logRows = queryValue(db, 'SELECT COUNT(*) FROM asop_activity_log');
  const plantedHandled = allCandidates.filter((c) => c.handled).length;

  console.log('\nTotals');
  assert('candidates qualifying', totalQualifying, allCandidates.length);
  assert('candidates logged', totalLogged, plantedHandled);
  assert('candidates missed', totalMissed, allCandidates.length - plantedHandled);
  assert('bypassed + unbypassed reconciles', totalBypassed + totalUnbypassed, totalMissed);
  console.log(
    `  ${DIM}note${RESET}  ${pad('miss breakdown', 46)} ` +
      `${totalBypassed} bypassed + ${totalUnbypassed} unbypassed = ${totalBypassed + totalUnbypassed}`,
  );
  console.log(
    `  ${DIM}note${RESET}  ${pad('activity log rows', 46)} ${logRows} ` +
      `${DIM}(${plantedHandled} matched + ${logRows - plantedHandled} unrelated firings)${RESET}`,
  );
  console.log(
    `  ${DIM}note${RESET}  ${pad('miss rate', 46)} ` +
      `${((totalMissed / totalQualifying) * 100).toFixed(1)}%`,
  );

  // 6. The key collision the generation stage has to reason about ----------
  console.log('\nPayload key ambiguity');
  for (const key of ['tool_id', 'batch_id']) {
    const shapes = runQuery(
      db,
      `SELECT DISTINCT asop_id FROM asop_activity_log
       WHERE json_extract(selection_payload, '$.${key}') IS NOT NULL
       ORDER BY asop_id`,
    );
    console.log(
      `  ${DIM}note${RESET}  ${pad(`$.${key} appears under`, 46)} ` +
        shapes.rows.map((row) => row.asop_id).join(', '),
    );
  }
  console.log(
    `  ${DIM}      ${pad('', 46)} so every baseline scopes its join by asop_id${RESET}`,
  );

  // 7. Query runner guards ------------------------------------------------
  console.log('\nQuery runner');
  assert('rejects a write in read-only mode', runQuery(db, 'DELETE FROM hold_records').ok, false);
  assert('rejects a second statement', runQuery(db, 'SELECT 1; SELECT 2').ok, false);
  assert('returns a syntax error as a value', runQuery(db, 'SELECT * FROM nope').error !== null, true);
  assert('binds named parameters', runQuery(db, 'SELECT $n AS n', { params: { $n: 42 } }).rows[0].n, 42);
  assert(
    'truncates past maxRows',
    runQuery(db, 'SELECT * FROM hold_records', { maxRows: 5 }).truncated,
    true,
  );

  // 8. Optional dump ------------------------------------------------------
  if (PRINT_SQL) {
    for (const baseline of BASELINES) {
      console.log(
        `\n${BOLD}${'='.repeat(76)}\n${baseline.asopId} — ${baseline.name}` +
          `${RESET}${DIM}   ${baseline.table} · ${baseline.shape}${RESET}\n`,
      );
      console.log(baseline.sql.trim());
    }
    console.log('');
  }

  db.close();

  console.log(
    failures === 0
      ? `\n${GREEN}All checks passed.${RESET}\n`
      : `\n${RED}${failures} check(s) failed.${RESET}\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`\n${RED}db-check failed:${RESET}`, error);
  process.exit(1);
});
