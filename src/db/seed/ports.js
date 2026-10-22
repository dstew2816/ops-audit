// port_state_history — DETECTION SHAPE: explicit intervals.
//
// 28 ports, four contiguous rows each: a long idle stretch, a short
// unit move, the interesting occupancy, then idle again with exited_at left
// NULL because the port is still in that state when the window closes.
//
// Ports are only interesting when they stop. A port that is working changes
// state every few minutes and a port that is not sits idle for days, so a
// history that covers 14 days in four rows is the honest shape here.
//
// Duration lives on the row: exited_at - entered_at.

import {
  ANALYSIS_END, DAY, HOUR, MIN, SEEDS, TOOL_IDS,
  WINDOW_START, between, iso, lcg, overlapsOutage, pick,
} from './common.js';

const rand = lcg(SEEDS.ports);

// Thresholds the two port ASOPs are configured with.
export const BLOCKED_THRESHOLD_MINUTES = 30;
export const ERROR_THRESHOLD_MINUTES = 15;

// ---------------------------------------------------------------------------
// Roster. `handled` is null for rows that are not candidates at all — either
// because the state is benign or because the occupancy is under threshold.
//
// A `startAt` pins the occupancy to a literal time; everything else is placed
// by the generator. The two pinned cases sit inside the 2026-07-29 outage.
// ---------------------------------------------------------------------------

const PORT_ROLES = [
  // --- blocked, over the 30m threshold: 12 candidates, 9 handled, 3 missed.
  { port: 'P-101', state: 'blocked', minutes: 47, handled: true },
  { port: 'P-102', state: 'blocked', minutes: 96, handled: true },
  { port: 'P-103', state: 'blocked', minutes: 38, handled: true },
  { port: 'P-104', state: 'blocked', minutes: 210, handled: false, startAt: '2026-07-29T02:35:00Z' },
  { port: 'P-105', state: 'blocked', minutes: 62, handled: true },
  // Missed AND bypassed: the port was in maintenance mode, which explains why
  // nothing fired and does not make the 2h25m block any less real.
  { port: 'P-106', state: 'blocked', minutes: 145, handled: false, mode: 'maint' },
  { port: 'P-107', state: 'blocked', minutes: 33, handled: true },
  { port: 'P-108', state: 'blocked', minutes: 74, handled: true, mode: 'maint' },
  { port: 'P-109', state: 'blocked', minutes: 51, handled: true },
  { port: 'P-110', state: 'blocked', minutes: 188, handled: false, startAt: '2026-07-29T03:20:00Z' },
  { port: 'P-111', state: 'blocked', minutes: 41, handled: true },
  { port: 'P-112', state: 'blocked', minutes: 66, handled: true },

  // --- error, over the 15m threshold: 4 candidates, 3 handled, 1 missed.
  { port: 'P-113', state: 'error', minutes: 22, handled: true },
  { port: 'P-114', state: 'error', minutes: 58, handled: false, mode: 'maint' },
  { port: 'P-115', state: 'error', minutes: 31, handled: true, mode: 'maint' },
  { port: 'P-116', state: 'error', minutes: 19, handled: true },

  // --- right state, under threshold. Present so the threshold has to do work.
  { port: 'P-117', state: 'blocked', minutes: 12, handled: null },
  { port: 'P-118', state: 'error', minutes: 8, handled: null },
  { port: 'P-119', state: 'blocked', minutes: 25, handled: null },
  { port: 'P-120', state: 'error', minutes: 11, handled: null },

  // --- benign occupancies.
  { port: 'P-121', state: 'idle', minutes: 640, handled: null },
  { port: 'P-122', state: 'unloading', minutes: 26, handled: null },
  { port: 'P-123', state: 'idle', minutes: 1180, handled: null },
  { port: 'P-124', state: 'loading', minutes: 18, handled: null },
  { port: 'P-125', state: 'idle', minutes: 415, handled: null },
  { port: 'P-126', state: 'unloading', minutes: 34, handled: null },
  { port: 'P-127', state: 'idle', minutes: 890, handled: null },
  { port: 'P-128', state: 'loading', minutes: 22, handled: null },
];

const isCandidate = (role) =>
  (role.state === 'blocked' && role.minutes > BLOCKED_THRESHOLD_MINUTES) ||
  (role.state === 'error' && role.minutes > ERROR_THRESHOLD_MINUTES);

const unitFor = (state, rand_) => {
  if (state === 'idle') return 0;
  if (state === 'error') return rand_() < 0.5 ? 1 : 0;
  return 1;
};

// ---------------------------------------------------------------------------
// Build.
// ---------------------------------------------------------------------------

const rows = [];
const candidates = [];

PORT_ROLES.forEach((role, index) => {
  const toolId = TOOL_IDS[index % TOOL_IDS.length];
  const moveState = pick(rand, ['loading', 'unloading']);
  const moveMinutes = between(rand, 10, 40);

  let start;
  if (role.startAt) {
    start = Date.parse(role.startAt);
  } else {
    start =
      WINDOW_START +
      6 * HOUR +
      between(rand, 0, 11) * DAY +
      between(rand, 0, 23) * HOUR +
      between(rand, 0, 59) * MIN;
  }
  let end = start + role.minutes * MIN;

  // A handled occupancy cannot sit inside the outage — the platform was not
  // running, so nothing could have picked it up.
  if (role.handled === true && overlapsOutage(start, end)) {
    start += 18 * HOUR;
    end += 18 * HOUR;
  }
  // Keep the trailing idle row inside the window.
  if (end > ANALYSIS_END - 2 * HOUR) {
    const shift = end - (ANALYSIS_END - 2 * HOUR);
    start -= shift;
    end -= shift;
  }

  const moveStart = start - moveMinutes * MIN;
  const mode = role.mode ?? (rand() < 0.12 ? 'manual' : 'auto');

  rows.push(
    {
      port_id: role.port,
      tool_id: toolId,
      state: 'idle',
      entered_at: iso(WINDOW_START),
      exited_at: iso(moveStart),
      unit_present: 0,
      port_mode: mode,
    },
    {
      port_id: role.port,
      tool_id: toolId,
      state: moveState,
      entered_at: iso(moveStart),
      exited_at: iso(start),
      unit_present: 1,
      port_mode: mode,
    },
    {
      port_id: role.port,
      tool_id: toolId,
      state: role.state,
      entered_at: iso(start),
      exited_at: iso(end),
      unit_present: unitFor(role.state, rand),
      port_mode: mode,
    },
    {
      port_id: role.port,
      tool_id: toolId,
      state: 'idle',
      entered_at: iso(end),
      exited_at: null, // still idle when the window closes
      unit_present: 0,
      port_mode: mode,
    },
  );

  if (!isCandidate(role)) return;

  candidates.push({
    table: 'port_state_history',
    asopId: role.state === 'blocked' ? 'ASOP-114' : 'ASOP-118',
    handled: role.handled === true,
    // What the automation would have grabbed during candidate selection.
    payload: {
      port_id: role.port,
      tool_id: toolId,
      state: role.state,
      entered_at: iso(start),
    },
    // When the condition became actionable — threshold elapsed, not interval start.
    actionableAt:
      start +
      (role.state === 'blocked' ? BLOCKED_THRESHOLD_MINUTES : ERROR_THRESHOLD_MINUTES) * MIN,
    intervalStart: start,
    intervalEnd: end,
    insideOutage: overlapsOutage(start, end),
  });
});

export const portStateHistory = rows.sort(
  (a, b) => a.entered_at.localeCompare(b.entered_at) || a.port_id.localeCompare(b.port_id),
);

export const portCandidates = candidates;
