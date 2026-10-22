// Turns the DDL and the seed rows into a live in-memory SQLite database.
//
// Environment-free on purpose: it takes an already-initialised sql.js module
// rather than initialising one itself, because the browser and Node locate the
// WASM binary differently. src/db/client.js does it one way and
// scripts/db-check.mjs does it the other, and both end up here.

import { DDL, TABLE_COLUMNS } from './schema.js';
import { SEED_ROWS } from './seed/index.js';

/**
 * @param {object} SQL an initialised sql.js module (the result of initSqlJs())
 * @returns {object} a populated sql.js Database
 */
export function buildDatabase(SQL) {
  const db = new SQL.Database();

  for (const statement of DDL) db.run(statement);

  db.run('BEGIN TRANSACTION');
  try {
    for (const [table, columns] of Object.entries(TABLE_COLUMNS)) {
      const rows = SEED_ROWS[table] ?? [];
      if (rows.length === 0) continue;

      const placeholders = columns.map(() => '?').join(', ');
      const insert = db.prepare(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
      );
      try {
        for (const row of rows) {
          // undefined and null both mean "no value"; sql.js only accepts null.
          insert.run(columns.map((column) => row[column] ?? null));
        }
      } finally {
        insert.free();
      }
    }
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    db.close();
    throw error;
  }

  return db;
}
