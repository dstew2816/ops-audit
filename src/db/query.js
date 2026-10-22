// Runs arbitrary SQL against a loaded database and returns rows.
//
// The generation stage will feed model-authored SQL through here, which shapes
// three of the decisions below:
//
//   - Rows come back as objects, not sql.js's parallel columns/values arrays,
//     because callers work with column names.
//   - Errors are returned as values rather than thrown. A query that fails is
//     a result to display and feed back, not an exception to unwind through.
//   - readOnly is the default. Generated SQL has no business writing.

const READ_ONLY_PREFIX = /^\s*(?:with|select|explain|pragma\s+table_info)\b/i;

// Statement separators outside string literals and comments. Used only to tell
// "one statement" from "several", not to parse SQL.
function countStatements(sql) {
  let count = 1;
  let quote = null;
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
      continue;
    }
    if (char === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }
    if (char === ';' && sql.slice(i + 1).trim() !== '') count += 1;
  }
  return count;
}

/**
 * Execute one statement and collect its rows.
 *
 * @param {object} db          a sql.js Database
 * @param {string} sql         a single SQL statement
 * @param {object} [options]
 * @param {object|Array} [options.params]   bound parameters, named or positional
 * @param {boolean} [options.readOnly=true] reject anything that is not a read
 * @param {number}  [options.maxRows=5000]  stop collecting past this many rows
 * @returns {{ok: boolean, columns: string[], rows: object[], rowCount: number,
 *            truncated: boolean, elapsedMs: number, sql: string,
 *            error: string|null}}
 */
export function runQuery(db, sql, options = {}) {
  const { params = null, readOnly = true, maxRows = 5000 } = options;
  const started = performance.now();

  const fail = (message) => ({
    ok: false,
    columns: [],
    rows: [],
    rowCount: 0,
    truncated: false,
    elapsedMs: performance.now() - started,
    sql,
    error: message,
  });

  if (typeof sql !== 'string' || sql.trim() === '') {
    return fail('No SQL supplied.');
  }
  if (readOnly) {
    if (!READ_ONLY_PREFIX.test(sql)) {
      return fail('Read-only: the statement must begin with SELECT, WITH, or EXPLAIN.');
    }
    if (countStatements(sql) > 1) {
      return fail('Read-only: expected a single statement.');
    }
  }

  let statement;
  try {
    statement = db.prepare(sql);
  } catch (error) {
    return fail(error.message);
  }

  try {
    if (params) statement.bind(params);

    const rows = [];
    let truncated = false;
    while (statement.step()) {
      if (rows.length >= maxRows) {
        truncated = true;
        break;
      }
      rows.push(statement.getAsObject());
    }

    // getColumnNames() is only populated once the statement has been stepped,
    // so a query returning nothing has to fall back to the row shape.
    const columns = statement.getColumnNames();

    return {
      ok: true,
      columns: columns.length > 0 ? columns : Object.keys(rows[0] ?? {}),
      rows,
      rowCount: rows.length,
      truncated,
      elapsedMs: performance.now() - started,
      sql,
      error: null,
    };
  } catch (error) {
    return fail(error.message);
  } finally {
    statement.free();
  }
}

/**
 * Single scalar from the first row and first column, or null.
 */
export function queryValue(db, sql, options = {}) {
  const result = runQuery(db, sql, { ...options, maxRows: 1 });
  if (!result.ok || result.rows.length === 0) return null;
  return Object.values(result.rows[0])[0] ?? null;
}

/**
 * Run several statements and return one result per statement. Reads only,
 * same as runQuery; useful for a batch of probes.
 */
export function runQueries(db, statements, options = {}) {
  return statements.map((sql) => runQuery(db, sql, options));
}

/** Table names present in the database, in schema order. */
export function listTables(db) {
  const result = runQuery(
    db,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY rootpage",
  );
  return result.rows.map((row) => row.name);
}

/** Column metadata for one table: name, declared type, nullability. */
export function describeTable(db, table) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) return [];
  const result = runQuery(db, `PRAGMA table_info(${table})`);
  return result.rows.map((row) => ({
    name: row.name,
    type: row.type,
    nullable: row.notnull === 0,
    primaryKey: row.pk > 0,
  }));
}
