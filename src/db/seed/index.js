// Assembles every seeded table into one map keyed by table name.
//
// Pure data. Nothing in here imports sql.js or touches the DOM, so the same
// rows load under Vite in the browser and under plain Node in
// scripts/db-check.mjs.

import { portStateHistory } from './ports.js';
import { batchQueueEvents } from './batches.js';
import { toolStatusLog } from './tools.js';
import { holdRecords } from './holds.js';
import { scheduledChecks } from './checks.js';
import { emailQueue } from './email.js';
import { asopActivityLog, allCandidates, ASOPS } from './asopLog.js';
import { platformStatusWindows } from './platform.js';
import { stationSpecs, stationMeasurements } from './measurements.js';
import { stations, stationVisits, stationHandoffs } from './stations.js';

export const SEED_ROWS = {
  port_state_history: portStateHistory,
  batch_queue_events: batchQueueEvents,
  tool_status_log: toolStatusLog,
  hold_records: holdRecords,
  scheduled_checks: scheduledChecks,
  email_queue: emailQueue,
  asop_activity_log: asopActivityLog,
  platform_status: platformStatusWindows,
  stations,
  station_visits: stationVisits,
  station_handoffs: stationHandoffs,
  station_specs: stationSpecs,
  station_measurements: stationMeasurements,
};

// The intended ground truth: every candidate the seeders planted, and whether
// the platform picked it up. Not loaded into the database — detection has to
// reconstruct this from the tables alone. Exported so scripts/db-check.mjs can
// check the reconstruction against what was planted.
export { allCandidates, ASOPS };

export { WINDOW_START, ANALYSIS_END, OUTAGE } from './common.js';
