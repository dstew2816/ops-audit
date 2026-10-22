// Runs every baseline and returns one plain record per miss: its id, the ASOP
// that missed it, and whether a bypass was attributed to it. Works on any
// loaded sql.js database, in the browser or under Node.

import { BASELINES, baselineParams } from '../db/baselines.js';
import { missId } from '../db/miss-id.js';
import { runQuery } from '../db/query.js';
import { ANALYSIS_END } from '../db/seed/index.js';

const END = new Date(ANALYSIS_END).toISOString().replace('.000Z', 'Z');

export function loadMissRecords(db) {
  const records = [];
  for (const baseline of BASELINES) {
    const params = baselineParams(baseline, { analysisEnd: END });
    const run = runQuery(db, baseline.sql, Object.keys(params).length ? { params } : {});
    if (!run.ok) throw new Error(`${baseline.asopId} failed: ${run.error}`);
    for (const row of run.rows) {
      records.push({
        missId: missId(baseline, row),
        asopId: baseline.asopId,
        asopName: baseline.name,
        bypassed: row.bypass !== null && row.bypass !== undefined,
      });
    }
  }
  return records;
}

/** Qualifying / logged / missed totals across every baseline's coverage query. */
export function loadCoverage(db) {
  const totals = { qualifying: 0, logged: 0, missed: 0 };
  for (const baseline of BASELINES) {
    const params = baselineParams(baseline, { analysisEnd: END });
    const run = runQuery(db, baseline.coverageSql, Object.keys(params).length ? { params } : {});
    if (!run.ok) throw new Error(`${baseline.asopId} coverage failed: ${run.error}`);
    const row = run.rows[0];
    totals.qualifying += row.qualifying;
    totals.logged += row.logged;
    totals.missed += row.missed;
  }
  return totals;
}
