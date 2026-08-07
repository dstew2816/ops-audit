# Audit Layer

A verification pass over AI-driven ITSM runbook automation.

The automation platform is event-driven and performs no historical replay. If it
is down when a trigger condition opens, or an event reaches it after the
condition has already cleared, the moment passes silently and leaves no trace in
the system that failed. Its execution log records what happened and says nothing
about what should have. This app is the independent reconciliation pass that
finds the difference.

## Running it

```
npm install
npm run dev      # http://localhost:5173
npm run build    # static output in dist/, deployable to GitHub Pages
```

`vite.config.js` sets `base: './'`, so the build works from any Pages subpath.

## How detection works

`src/engine/detect.js`:

1. **Reconstruct intervals.** Group events by resource, sort by `timestamp`, and
   pair each state change with the next one — the equivalent of a SQL `LEAD()`
   window function. A resource's final event has no successor, so its interval is
   left open and closed at the end of the analysis window.
2. **Match triggers.** Find intervals whose state equals a runbook's
   `triggerState` and whose duration exceeds its `thresholdMinutes`.
3. **Evaluate exclusions.** `exclusionList` and `excludedResourceTypes` are
   applied and attributed to the responsible rule. They are recorded on the miss
   rather than suppressing it: an exclusion explains why nothing fired, but the
   condition still held and nothing addressed it.
4. **Anti-join the execution log.** Match on `runbookId + resourceId` where
   `firedAt` falls inside the interval, widened by 2 minutes for clock drift at
   the leading edge and 10 minutes of poll cycle plus 2 minutes of drift at the
   trailing edge. No match is a miss.
5. **Emit miss records** carrying the interval, the tolerance window searched,
   every execution found outside it and by how far, ingest lag, and platform
   status during the interval.

Intervals are built from `timestamp` — when the state change actually happened —
never from `ingestTimestamp`, when the platform found out. That asymmetry is the
point: it is what lets this pass see conditions the live platform could not.

## Data

Seeded under `src/data/`, deterministic across reloads. Background traffic comes
from a fixed-seed LCG; every planted case is written out literally and labelled.
335 events across 60 resources over 14 days, 2026-07-23 to 2026-08-06.

Current output: 1,005 interval/runbook evaluations, 54 actions expected, 41
logged, **13 misses at a 24.1% miss rate**.

### Planted cases

| Category | Case | In the report |
|---|---|---|
| Infrastructure | `SVC-07`, `SVC-12`, `TKT-05`, `REQ-09` — conditions opened and cleared entirely inside the 6h outage on 2026-07-29 | 4 misses |
| Configuration | `TKT-14`, `TKT-15` — sit on RB-002's exclusion list, bulk-added as a contiguous `TKT-13..TKT-16` range and never trimmed | 2 misses, tagged `excluded` |
| Data | `SVC-18` — `ingestTimestamp` is 4 hours after `timestamp`; the resource had already recovered by the time the platform saw it | 1 miss |
| Detector error | `REQ-04` — RB-003 *did* fire, 14 minutes after the interval closed. Tolerance allows 12. | 1 miss, and it is **wrong** |
| Logic gap | `SVC-03` — sat 40 minutes in `unresponsive_degraded`, which is not RB-001's exact `triggerState` of `unresponsive` | **absent by design** |

Two of these need care when reading the report.

The **detector error** is a false positive of this tool, not of the platform. It
appears as an ordinary miss row and is not labelled as suspect. The evidence is
all there — expanding the row shows `LOG-0046` firing 2 minutes past the window
edge — but the verdict line still says miss. It is in the data to keep the miss
count honest about its own error rate.

The **logic gap** is invisible to this pass. Trigger matching is exact string
equality, so a detector with RB-001's configuration cannot see
`unresponsive_degraded` any more than the live platform could. The interval is in
the data and can be found; surfacing it needs analysis this pass does not do.

## Scope

Detection and display only. Root-cause categorisation — deciding that a given
miss belongs to the infrastructure, configuration, data, logic-gap, or
detector-error class — is deliberately left to the next pass. The miss records
already carry the fields it will need.
