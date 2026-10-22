// Scoring generated detection SQL against the hand-written baseline.
//
// Pure. No model, no network, no environment, no key. It takes a loaded
// database, one baseline out of src/db/baselines.js and one generated
// candidate, and reports what agrees and what does not. Everything it needs is
// an argument, which is what makes scripts/gen-check.mjs able to prove the
// scorer with --self-test before spending a live call: feed a baseline its own
// SQL and every dimension below has to come out perfect. Without that, a bug
// in here and a bad generation look exactly the same from the outside.
//
// FIVE DIMENSIONS, BECAUSE THEY FAIL SEPARATELY
//
//   resolution  Did it pick the right ASOP, the right table, the right shape?
//   execution   Does the SQL run at all, and what did SQLite say if not?
//   counts      How many misses did it find against how many are really there?
//   rows        WHICH misses — compared by identity, not by count.
//   structure   Does it obey the house rules, whatever its numbers say?
//
// Counts and rows are separate on purpose. A query that finds seven misses when
// there are seven, but a different seven, scores perfectly on counts and is
// completely wrong. Only the identity comparison catches that, and it is the
// reason antiJoinKeys is carried on every baseline.
//
// STRUCTURE IS SCORED EVEN WHEN THE NUMBERS ARE RIGHT
//
// A generated query that filters its bypassed candidates out returns fewer rows
// than the baseline and is caught by rows. But one that never extracted the
// bypass at all returns the SAME rows with the reason missing — right count,
// right identities, and the attribution that the whole design exists to carry
// is gone. That is only visible in the text, so the house-rule predicates from
// src/db/house-rules.js are applied here too rather than trusted from earlier.
//
// A WRONG RESOLUTION IS STILL SCORED AGAINST THE EXPECTED BASELINE
//
// Deliberately. SQL scoped to the wrong asop_id anti-joins against another
// automation's log rows, matches nothing, and returns every candidate it
// evaluated as a miss. Scoring it against the baseline it should have been is
// what makes that show up as a pile of extras rather than as a quiet pass
// against the query's own idea of what it was doing.

import { runQuery } from '../db/query.js';
import { baselineParams } from '../db/baselines.js';
import {
  attributesBypass,
  bypassColumn,
  filterLinesMentioning,
  hasBypassColumn,
  outerFilter,
  outerFilterIsAntiJoin,
} from '../db/house-rules.js';

/**
 * The baselines describe their own shape in prose — "explicit intervals" — and
 * the extract stage picks from a fixed enum. Neither vocabulary is wrong and
 * neither should be bent to the other: the baselines are documentation of a
 * candidate type and the enum is an interface the model writes to. They meet
 * here, once.
 */
export const SHAPE_FOR_BASELINE = {
  'explicit intervals': 'interval',
  'countdown to a deadline': 'countdown',
  'unplanned windows': 'unplanned-window',
  'null check': 'null-check',
  absence: 'absence',
  'retry chain': 'retry-chain',
};

/** The columns an antiJoinKeys path list names, with the JSON prefix stripped. */
export function identityColumns(baseline) {
  return baseline.antiJoinKeys.map((key) => key.replace(/^\$\./, ''));
}

/** One row's identity, as a comparable string. */
function identityOf(row, columns) {
  return columns.map((column) => JSON.stringify(row[column] ?? null)).join(' | ');
}

/** sql.js binds an empty object happily; passing null keeps the intent clear. */
function bindOf(params) {
  return params && Object.keys(params).length > 0 ? { params } : {};
}

/**
 * A baseline dressed as a generated candidate, for the self-test.
 *
 * Every field is taken from the baseline itself, so scoring this has to come
 * out perfect on all five dimensions. It is the only thing in this module that
 * knows how a baseline's metadata maps onto a generated spec.
 */
export function candidateFromBaseline(baseline, { analysisEnd }) {
  return {
    asopId: baseline.asopId,
    spec: {
      table: baseline.table,
      shape: SHAPE_FOR_BASELINE[baseline.shape] ?? baseline.shape,
      bypasses: baseline.bypasses.map((bypass) => ({
        name: bypass.name,
        expression: bypass.clause,
        note: bypass.note,
      })),
    },
    sql: baseline.sql,
    params: baselineParams(baseline, { analysisEnd }),
  };
}

// ---------------------------------------------------------------------------
// The dimensions
// ---------------------------------------------------------------------------

function compare(label, expected, actual) {
  return { label, expected, actual, ok: expected === actual };
}

function scoreResolution(baseline, candidate) {
  const spec = candidate.spec ?? {};
  const checks = [
    compare('asopId', baseline.asopId, candidate.asopId ?? null),
    compare('table', baseline.table, spec.table ?? null),
    compare('shape', SHAPE_FOR_BASELINE[baseline.shape] ?? baseline.shape, spec.shape ?? null),
  ];
  return { checks, ok: checks.every((check) => check.ok) };
}

function scoreRows(baseline, candidate, truth, run) {
  const columns = identityColumns(baseline);
  const missingColumns = run.ok ? columns.filter((column) => !run.columns.includes(column)) : columns;

  const empty = {
    identityColumns: columns,
    missingColumns,
    comparable: false,
    matched: 0,
    extras: [],
    omissions: [],
    duplicates: [],
    attributionComparable: false,
    attributionDisagreements: [],
    ok: false,
  };

  // Not being able to tell which rows these are is itself the finding. A query
  // whose output does not carry the identifiers cannot be reconciled with
  // anything, however many rows it returned.
  if (!run.ok || missingColumns.length > 0) return empty;

  const index = (rows) => {
    const byIdentity = new Map();
    const duplicates = [];
    for (const row of rows) {
      const key = identityOf(row, columns);
      if (byIdentity.has(key)) duplicates.push(key);
      else byIdentity.set(key, row);
    }
    return { byIdentity, duplicates };
  };

  const expected = index(truth.rows);
  const actual = index(run.rows);

  const matchedKeys = [...expected.byIdentity.keys()].filter((key) => actual.byIdentity.has(key));
  const omissions = [...expected.byIdentity.keys()].filter((key) => !actual.byIdentity.has(key));
  const extras = [...actual.byIdentity.keys()].filter((key) => !expected.byIdentity.has(key));

  // Whether a matched row carries its bypass reason, not what the text of it
  // says — the wording is the model's to choose, the presence is not.
  const attributionComparable = run.columns.includes('bypass');
  const attributionDisagreements = attributionComparable
    ? matchedKeys
        .map((key) => ({
          identity: key,
          expected: expected.byIdentity.get(key).bypass,
          actual: actual.byIdentity.get(key).bypass,
        }))
        .filter((row) => (row.expected === null) !== (row.actual === null))
    : [];

  return {
    identityColumns: columns,
    missingColumns: [],
    comparable: true,
    matched: matchedKeys.length,
    extras,
    omissions,
    duplicates: actual.duplicates,
    attributionComparable,
    attributionDisagreements,
    ok:
      extras.length === 0 &&
      omissions.length === 0 &&
      actual.duplicates.length === 0 &&
      attributionComparable &&
      attributionDisagreements.length === 0,
  };
}

function scoreStructure(baseline, candidate) {
  const sql = candidate.sql ?? '';
  const checks = [];
  const check = (name, ok, detail = '') => checks.push({ name, ok, detail });

  check(
    'outer filter is the anti-join',
    outerFilterIsAntiJoin(sql),
    outerFilter(sql) ?? 'no WHERE clause',
  );
  check('joins asop_activity_log', sql.includes('asop_activity_log'));
  check(
    'anti-join scoped by asop_id',
    candidate.asopId ? sql.includes(`'${candidate.asopId}'`) : false,
    candidate.asopId ? `'${candidate.asopId}'` : 'no ASOP resolved',
  );
  check('reads selection_payload', /json_extract\s*\(/i.test(sql));
  check('has a bypass column', hasBypassColumn(sql), 'NULL AS bypass when there are none');

  // Every bypass the spec declared has to be attributed and must not be
  // filtered on. Both directions matter: attributed-but-also-filtered returns
  // the reason on the rows it kept and drops the rest.
  for (const bypass of candidate.spec?.bypasses ?? []) {
    const column = bypassColumn(bypass.expression);
    if (!column) continue;
    check(`bypass "${bypass.name}" attributed`, attributesBypass(sql, column), column);
    const filtered = filterLinesMentioning(sql, column);
    check(`bypass "${bypass.name}" not filtered on`, filtered.length === 0, filtered[0] ?? '');
  }

  // And every bypass the BASELINE declares has to be attributed, whether or not
  // extraction found it. A bypass that was never extracted produces a query
  // with the right rows and no reason on them, which the row comparison cannot
  // see and which is the quietest way for this to be wrong.
  const unattributed = baseline.bypasses.filter(
    (bypass) => !attributesBypass(sql, bypassColumn(bypass.clause)),
  );
  check(
    'baseline bypasses attributed',
    unattributed.length === 0,
    unattributed.length === 0
      ? `${baseline.bypasses.length} declared`
      : `missing: ${unattributed.map((bypass) => bypass.name).join(', ')}`,
  );

  return { checks, ok: checks.every((entry) => entry.ok) };
}

// ---------------------------------------------------------------------------

/**
 * Score one generated candidate against one baseline.
 *
 * @param {object}  db          a loaded sql.js database
 * @param {object}  baseline    the entry from src/db/baselines.js it should match
 * @param {object}  candidate   {asopId, spec, sql, params} — spec is read for
 *                              table, shape and bypasses only
 * @param {string}  analysisEnd the analysis window's closing edge, for the
 *                              baseline's own binding
 */
export function scoreCandidate({ db, baseline, candidate, analysisEnd }) {
  const truth = runQuery(db, baseline.sql, bindOf(baselineParams(baseline, { analysisEnd })));
  if (!truth.ok) {
    // Ground truth that does not run is a harness fault, not a finding about
    // the candidate. Say which it is rather than reporting a spurious diff.
    return {
      asopId: baseline.asopId,
      groundTruthError: truth.error,
      ok: false,
      failures: [`baseline SQL failed to run: ${truth.error}`],
    };
  }

  const run = runQuery(db, candidate.sql ?? '', {
    ...bindOf(candidate.params),
    readOnly: true,
  });

  const resolution = scoreResolution(baseline, candidate);
  const execution = {
    ok: run.ok,
    error: run.error,
    rowCount: run.rowCount,
    columns: run.columns,
    truncated: run.truncated,
    elapsedMs: run.elapsedMs,
  };
  const counts = {
    expected: truth.rowCount,
    actual: run.ok ? run.rowCount : null,
    ok: run.ok && run.rowCount === truth.rowCount,
  };
  const rows = scoreRows(baseline, candidate, truth, run);
  const structure = scoreStructure(baseline, candidate);

  const failures = [];
  for (const entry of resolution.checks) {
    if (!entry.ok) failures.push(`${entry.label}: expected ${entry.expected}, got ${entry.actual}`);
  }
  if (!execution.ok) failures.push(`SQL error: ${execution.error}`);
  if (execution.ok && !counts.ok) {
    failures.push(`returned ${counts.actual} rows, baseline finds ${counts.expected}`);
  }
  if (rows.missingColumns.length > 0 && execution.ok) {
    failures.push(`output has no ${rows.missingColumns.join(', ')} — rows cannot be identified`);
  }
  if (rows.comparable) {
    if (rows.extras.length > 0) failures.push(`${rows.extras.length} row(s) not in the baseline`);
    if (rows.omissions.length > 0) failures.push(`${rows.omissions.length} baseline row(s) missing`);
    if (rows.duplicates.length > 0) {
      failures.push(`${rows.duplicates.length} duplicate identity/identities returned`);
    }
    if (!rows.attributionComparable) failures.push('no bypass column to compare attribution on');
    for (const row of rows.attributionDisagreements) {
      failures.push(
        `attribution differs on ${row.identity}: baseline ${row.expected === null ? 'none' : JSON.stringify(row.expected)}, got ${row.actual === null ? 'none' : JSON.stringify(row.actual)}`,
      );
    }
  }
  for (const entry of structure.checks) {
    if (!entry.ok) failures.push(`house rule — ${entry.name}${entry.detail ? `: ${entry.detail}` : ''}`);
  }

  return {
    asopId: baseline.asopId,
    groundTruthError: null,
    resolution,
    execution,
    counts,
    rows,
    structure,
    ok: resolution.ok && execution.ok && counts.ok && rows.ok && structure.ok,
    failures,
  };
}
