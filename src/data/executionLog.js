// Records of runbook executions that the automation platform actually performed.
//
// This is the only trace the platform keeps. It records what *did* happen and
// says nothing at all about what should have. Reconstructing the gap is the
// whole job of the audit layer.
//
// Built from the intended episodes in events.js so the log stays consistent with
// the event stream, rather than being re-derived through the detector itself.

import { episodes } from './events';
import { runbooksById } from './runbooks';

const MIN = 60_000;
const T = (iso) => Date.parse(iso);

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const rand = lcg(77712024);

function outcomeFor() {
  const roll = rand();
  if (roll < 0.86) return 'success';
  if (roll < 0.95) return 'retried_success';
  return 'failed';
}

const entries = [];

for (const episode of episodes) {
  const runbook = runbooksById[episode.runbookId];

  if (episode.lateLogOffsetMinutes != null) {
    // Fired, but after the interval had already closed.
    entries.push({
      runbookId: episode.runbookId,
      resourceId: episode.resourceId,
      firedAt: episode.end + episode.lateLogOffsetMinutes * MIN,
      action: runbook.action,
      outcome: 'success',
    });
    continue;
  }

  if (!episode.handled) continue;

  // Polling picks the condition up shortly after the threshold elapses.
  const jitterMs = Math.floor(rand() * 8) * MIN + Math.floor(rand() * 60) * 1000;
  entries.push({
    runbookId: episode.runbookId,
    resourceId: episode.resourceId,
    firedAt: episode.start + runbook.thresholdMinutes * MIN + jitterMs,
    action: runbook.action,
    outcome: outcomeFor(),
  });
}

// Executions against resources with no qualifying interval in this window —
// carried over from earlier conditions or manually invoked. Present so the
// anti-join has to do real work rather than matching on resource identity alone.
const noiseEntries = [
  { runbookId: 'RB-001', resourceId: 'SVC-19', firedAt: T('2026-07-24T04:12:00Z'), action: 'restart_service', outcome: 'success' },
  { runbookId: 'RB-001', resourceId: 'SVC-20', firedAt: T('2026-07-27T22:41:00Z'), action: 'restart_service', outcome: 'failed' },
  { runbookId: 'RB-002', resourceId: 'TKT-13', firedAt: T('2026-07-25T13:05:00Z'), action: 'reopen_and_reassign', outcome: 'success' },
  { runbookId: 'RB-002', resourceId: 'TKT-16', firedAt: T('2026-08-01T09:33:00Z'), action: 'reopen_and_reassign', outcome: 'success' },
  { runbookId: 'RB-003', resourceId: 'REQ-20', firedAt: T('2026-07-31T16:58:00Z'), action: 'escalate_to_queue_manager', outcome: 'retried_success' },
  { runbookId: 'RB-003', resourceId: 'REQ-20', firedAt: T('2026-08-04T11:20:00Z'), action: 'escalate_to_queue_manager', outcome: 'success' },
];

export const executionLog = [...entries, ...noiseEntries]
  .sort((a, b) => a.firedAt - b.firedAt)
  .map((entry, i) => ({
    logId: `LOG-${String(i + 1).padStart(4, '0')}`,
    runbookId: entry.runbookId,
    resourceId: entry.resourceId,
    firedAt: new Date(entry.firedAt).toISOString(),
    action: entry.action,
    outcome: entry.outcome,
  }));
