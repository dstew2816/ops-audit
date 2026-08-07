// Detection engine.
//
// The automation platform is event-driven and keeps no historical replay: if it
// was down, or an event arrived late, the trigger condition passed unobserved
// and left no trace in the system that failed. This is the independent
// reconciliation pass. It rebuilds what the resource state actually was, works
// out which runbook actions that state should have produced, and anti-joins
// against the execution log to find the ones that never happened.
//
// Pipeline:
//   1. reconstructIntervals — LEAD() over each resource's event stream
//   2. matching             — interval state vs. runbook trigger + threshold
//   3. exclusions           — evaluated and attributed, not suppressed
//   4. anti-join            — executionLog within a tolerance window
//   5. miss records         — carrying the evidence for each verdict

import { MINUTE_MS, ms, minutesBetween } from './time';
import { statusDuring } from '../data/platformStatus';

// Tolerance the anti-join grants the platform before calling something a miss.
export const POLLING_TOLERANCE_MINUTES = 10; // scheduler poll cycle
export const CLOCK_DRIFT_MINUTES = 2; // orchestrator vs. collector clock skew

// -----------------------------------------------------------------------------
// 1. Interval reconstruction
// -----------------------------------------------------------------------------

/**
 * Pair each state-change event with the next one for the same resource, which
 * is the equivalent of a SQL LEAD() window function:
 *
 *   SELECT resource_id, state, timestamp AS interval_start,
 *          LEAD(timestamp) OVER (
 *            PARTITION BY resource_id ORDER BY timestamp
 *          ) AS interval_end
 *   FROM events
 *
 * Intervals are built from `timestamp` (when the change happened), never from
 * `ingestTimestamp` (when the platform found out). That asymmetry is what lets
 * this pass see conditions the live platform could not.
 *
 * The final event for a resource has no successor; its interval is left open and
 * closed at `analysisEnd`.
 */
export function reconstructIntervals(events, analysisEnd) {
  const byResource = new Map();
  for (const event of events) {
    if (!byResource.has(event.resourceId)) byResource.set(event.resourceId, []);
    byResource.get(event.resourceId).push(event);
  }

  const end = ms(analysisEnd);
  const intervals = [];

  for (const [resourceId, stream] of byResource) {
    const sorted = [...stream].sort(
      (a, b) => ms(a.timestamp) - ms(b.timestamp) || a.eventId.localeCompare(b.eventId),
    );

    for (let i = 0; i < sorted.length; i += 1) {
      const current = sorted[i];
      const next = sorted[i + 1] ?? null;

      const start = ms(current.timestamp);
      const stop = next ? ms(next.timestamp) : end;
      if (stop <= start) continue; // duplicate or out-of-window event

      intervals.push({
        intervalId: `IV-${current.eventId}`,
        resourceId,
        resourceType: current.resourceType,
        state: current.state,
        start,
        end: stop,
        durationMinutes: (stop - start) / MINUTE_MS,
        open: next === null,
        startEvent: current,
        endEvent: next,
        // Delay between the change happening and the platform seeing it. The
        // platform could not have acted before this point.
        ingestLagMinutes: minutesBetween(current.timestamp, current.ingestTimestamp),
      });
    }
  }

  return intervals.sort((a, b) => a.start - b.start);
}

// -----------------------------------------------------------------------------
// 2 + 3. Trigger matching and exclusions
// -----------------------------------------------------------------------------

function exclusionFor(interval, runbook) {
  if (runbook.excludedResourceTypes?.includes(interval.resourceType)) {
    return { excluded: true, excludedBy: 'excludedResourceTypes', excludedValue: interval.resourceType };
  }
  if (runbook.exclusionList?.includes(interval.resourceId)) {
    return { excluded: true, excludedBy: 'exclusionList', excludedValue: interval.resourceId };
  }
  return { excluded: false, excludedBy: null, excludedValue: null };
}

// -----------------------------------------------------------------------------
// 4. Anti-join against the execution log
// -----------------------------------------------------------------------------

/**
 * A logged execution counts as covering an interval when it fired inside the
 * interval, allowing CLOCK_DRIFT_MINUTES of skew at the leading edge and
 * POLLING_TOLERANCE_MINUTES + CLOCK_DRIFT_MINUTES of slack at the trailing edge:
 * the condition can clear moments before a poll that was already going to catch
 * it. Anything outside that window is not credited.
 */
function toleranceWindow(interval) {
  return {
    start: interval.start - CLOCK_DRIFT_MINUTES * MINUTE_MS,
    end:
      interval.end +
      (POLLING_TOLERANCE_MINUTES + CLOCK_DRIFT_MINUTES) * MINUTE_MS,
  };
}

function indexLog(executionLog) {
  const index = new Map();
  for (const entry of executionLog) {
    const key = `${entry.runbookId}::${entry.resourceId}`;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({ ...entry, firedAtMs: ms(entry.firedAt) });
  }
  for (const list of index.values()) list.sort((a, b) => a.firedAtMs - b.firedAtMs);
  return index;
}

// -----------------------------------------------------------------------------
// Main entry point
// -----------------------------------------------------------------------------

export function detect({ events, runbooks, executionLog, analysisEnd }) {
  const intervals = reconstructIntervals(events, analysisEnd);
  const logIndex = indexLog(executionLog);

  let evaluations = 0;
  const expected = [];

  for (const interval of intervals) {
    for (const runbook of runbooks) {
      evaluations += 1;

      // 2. Does this interval match the runbook's trigger condition?
      if (interval.resourceType !== runbook.resourceType) continue;
      if (interval.state !== runbook.triggerState) continue;
      if (interval.durationMinutes <= runbook.thresholdMinutes) continue;

      // 3. Exclusions are evaluated and attributed. They explain why nothing
      // fired; they do not make the gap stop existing, so the interval is still
      // carried through to the report with the responsible rule attached.
      const exclusion = exclusionFor(interval, runbook);

      // 4. Anti-join.
      const window = toleranceWindow(interval);
      const candidates = logIndex.get(`${runbook.id}::${interval.resourceId}`) ?? [];
      const matched =
        candidates.find(
          (entry) => entry.firedAtMs >= window.start && entry.firedAtMs <= window.end,
        ) ?? null;

      const candidateDetail = candidates.map((entry) => {
        const inside =
          entry.firedAtMs >= window.start && entry.firedAtMs <= window.end;
        let offsetMinutes = 0;
        if (entry.firedAtMs < window.start) {
          offsetMinutes = (entry.firedAtMs - window.start) / MINUTE_MS;
        } else if (entry.firedAtMs > window.end) {
          offsetMinutes = (entry.firedAtMs - window.end) / MINUTE_MS;
        }
        return {
          logId: entry.logId,
          firedAt: entry.firedAt,
          firedAtMs: entry.firedAtMs,
          action: entry.action,
          outcome: entry.outcome,
          insideWindow: inside,
          // Signed distance from the nearest edge of the tolerance window.
          offsetFromWindowMinutes: offsetMinutes,
          offsetFromIntervalEndMinutes: (entry.firedAtMs - interval.end) / MINUTE_MS,
        };
      });

      expected.push({
        id: `${runbook.id}::${interval.intervalId}`,
        interval,
        runbook,
        exclusion,
        window,
        matched,
        candidates: candidateDetail,
      });
    }
  }

  // 5. Miss records.
  const misses = expected
    .filter((record) => record.matched === null)
    .map(({ id, interval, runbook, exclusion, window, candidates }) => ({
      id,
      resourceId: interval.resourceId,
      resourceType: interval.resourceType,

      runbookId: runbook.id,
      runbookName: runbook.name,
      action: runbook.action,
      owner: runbook.owner,

      state: interval.state,
      triggerState: runbook.triggerState,
      thresholdMinutes: runbook.thresholdMinutes,

      intervalStart: interval.start,
      intervalEnd: interval.end,
      durationMinutes: interval.durationMinutes,
      exceededThresholdByMinutes: interval.durationMinutes - runbook.thresholdMinutes,
      intervalOpen: interval.open,

      startEventId: interval.startEvent.eventId,
      endEventId: interval.endEvent?.eventId ?? null,
      startEventIngest: interval.startEvent.ingestTimestamp,
      ingestLagMinutes: interval.ingestLagMinutes,

      toleranceWindowStart: window.start,
      toleranceWindowEnd: window.end,
      pollingToleranceMinutes: POLLING_TOLERANCE_MINUTES,
      clockDriftMinutes: CLOCK_DRIFT_MINUTES,

      candidates,
      matchedLog: null,

      excluded: exclusion.excluded,
      excludedBy: exclusion.excludedBy,
      excludedValue: exclusion.excludedValue,

      platformStatus: statusDuring(interval.start, interval.end),
    }))
    .sort((a, b) => a.intervalStart - b.intervalStart);

  const logged = expected.length - misses.length;

  return {
    intervals,
    expected,
    misses,
    stats: {
      resourcesObserved: new Set(intervals.map((i) => i.resourceId)).size,
      eventsIngested: events.length,
      intervalsReconstructed: intervals.length,
      intervalsEvaluated: evaluations,
      actionsExpected: expected.length,
      actionsLogged: logged,
      missesFound: misses.length,
      missRate: expected.length ? misses.length / expected.length : 0,
      executionsRecorded: executionLog.length,
    },
  };
}

/** Executions per runbook that landed inside the analysis window. */
export function firedCounts(executionLog, windowStart, windowEnd) {
  const counts = {};
  for (const entry of executionLog) {
    const at = ms(entry.firedAt);
    if (at < ms(windowStart) || at > ms(windowEnd)) continue;
    counts[entry.runbookId] = (counts[entry.runbookId] ?? 0) + 1;
  }
  return counts;
}
