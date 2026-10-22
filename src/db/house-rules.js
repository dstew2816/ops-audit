// The house rules a detection query has to follow to mean anything here.
//
// One module because three callers check the same properties and a drift
// between them would be invisible — each would keep passing its own copy:
//
//   src/engine/generate-sql.js   on generated SQL, before it has ever run
//   src/engine/score.js          on generated SQL, alongside its baseline
//   scripts/db-check.mjs         on the hand-written baselines themselves
//
// Every rule here is a predicate over SQL TEXT, and deliberately so. The bypass
// rule in particular cannot wait for execution: a query that filters its
// bypassed candidates out runs perfectly, returns a plausible number, and is
// silently missing the findings that most needed reporting. There is no row
// count that reveals that. Only reading the clause does.
//
// Nothing here parses SQL. These are line-level tests against the shape the
// baselines are written in and the shape the compose prompt asks for; that
// convention is what makes them checkable at all.

/**
 * Lines that filter rows: a WHERE, or a continuation of one.
 *
 * JOIN ... ON continuations also start with AND, so this over-collects. That is
 * why the bypass check below reports the line it found rather than assuming
 * what it means — a false positive that shows its evidence is readable, a
 * silent miss is not.
 */
export function filterLines(sql) {
  return sql
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(WHERE|AND|OR)\b/i.test(line));
}

/** The text every outer filter has to be, verbatim. */
export const ANTI_JOIN_FILTER = 'WHERE l.log_id IS NULL';

/** The last WHERE line in the query — the outer one — or null if there is none. */
export function outerFilter(sql) {
  return filterLines(sql).filter((line) => /^WHERE\b/i.test(line)).pop() ?? null;
}

/**
 * Is this line the anti-join and nothing else?
 *
 * Anything more in the outer filter drops candidates after they have already
 * qualified, which is the one thing this pass must never do. Everything that
 * decides what qualifies belongs inside the CTE.
 */
export function isAntiJoinFilter(line) {
  return typeof line === 'string' && /^WHERE\s+l\.log_id\s+IS\s+NULL$/i.test(line.trim());
}

export function outerFilterIsAntiJoin(sql) {
  return isAntiJoinFilter(outerFilter(sql));
}

/**
 * The column a bypass tests on, taken from the front of its expression.
 *
 * "port_mode = 'maint'" -> port_mode, "skip_reason IS NOT NULL" -> skip_reason.
 * Null when the expression does not start with an identifier.
 */
export function bypassColumn(expression) {
  if (typeof expression !== 'string') return null;
  return (expression.match(/[A-Za-z_][A-Za-z0-9_]*/) ?? [null])[0];
}

/**
 * Does the query attribute this column onto its rows?
 *
 * A bypass has to appear as a CASE expression in the SELECT list, with or
 * without a table alias, so the reason travels with the finding.
 */
export function attributesBypass(sql, column) {
  if (!column) return false;
  return new RegExp(`CASE\\s+WHEN\\s+(?:[A-Za-z_][A-Za-z0-9_]*\\.)?${column}\\b`, 'i').test(sql);
}

/** Filter lines mentioning this column — the evidence that a bypass suppresses. */
export function filterLinesMentioning(sql, column) {
  if (!column) return [];
  return filterLines(sql).filter((line) => new RegExp(`\\b${column}\\b`).test(line));
}

/** Is there a column aliased "bypass" at all? NULL AS bypass counts. */
export function hasBypassColumn(sql) {
  return /\bAS\s+bypass\b/i.test(sql);
}
