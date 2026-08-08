# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```
npm install
npm run dev      # http://localhost:5173
npm run build    # static output in dist/ (gitignored)
npm run preview  # serve the built output
npm run record   # re-capture Generate-tab fixtures; needs VITE_ANTHROPIC_API_KEY
```

There is no test runner, linter, or type checker configured. Verification is by running the app and reading the numbers in the header and stats row.

Push to `main` triggers `.github/workflows/deploy.yml`, which builds and publishes `dist/` to GitHub Pages. `vite.config.js` sets `base: './'` so the build works from any Pages subpath — don't change that to an absolute base.

## What this is

React 19 + Vite + Tailwind v4 single-page app, no backend, no router. Audit data is seeded in `src/data/` and the whole analysis runs once in a `useMemo` in `src/App.jsx`. Three tabs: Runbooks, Audit, Generate.

The premise: an ITSM automation platform is event-driven with no historical replay. If it is down when a trigger condition opens, or an event arrives after the condition cleared, nothing fires and nothing is recorded in the system that failed. This app is the independent reconciliation pass that reconstructs what should have happened and anti-joins it against what did.

## Architecture

Data flows one way: `src/data/*` → `detect()` in `src/engine/detect.js` → a single `result` object → components. Components are presentation only; all logic lives in the engine.

`detect()` pipeline (documented in detail at the top of `detect.js`):

1. **`reconstructIntervals`** — group events by resource, sort, pair each state change with the next (a SQL `LEAD()`). The last event per resource is left open and closed at `analysisEnd`.
2. **Trigger matching** — `resourceType` equal, `state` equal to `triggerState` (exact string equality), duration over `thresholdMinutes`.
3. **Exclusions** — `exclusionList` / `excludedResourceTypes` are evaluated and *attributed onto the miss record*, never used to suppress it. An exclusion explains why nothing fired; the gap still existed.
4. **Anti-join** — match `runbookId + resourceId` where `firedAt` lands in the interval widened by `CLOCK_DRIFT_MINUTES` (2) at the leading edge and `POLLING_TOLERANCE_MINUTES + CLOCK_DRIFT_MINUTES` (12) at the trailing edge.
5. **Miss records** — carry the interval, the tolerance window searched, every candidate execution with its signed offset from the window, ingest lag, and platform status during the interval.

### The invariant that matters

Intervals are built from `timestamp` (when the state change happened), **never** from `ingestTimestamp` (when the platform learned of it). That asymmetry is the entire reason this pass sees conditions the live platform could not. Any change that reconstructs state from `ingestTimestamp` defeats the app.

### Scope boundary

Detection and display only. Root-cause categorisation — assigning a miss to the infrastructure / configuration / data / logic-gap / detector-error class — is deliberately left to a later pass. The miss records already carry the fields it would need. Don't add classification to `detect.js` unless asked.

## The generation layer (Generate tab)

`src/engine/generate.js` is the only module that talks to a model. Messy runbook documentation (`src/data/templates.js`) → `claude-opus-5` under a JSON schema → validated definition → the same `detect()` pipeline. Everything downstream operates on the parsed object and doesn't know where it came from.

**The generated definition takes the ID of the runbook whose documentation it was extracted from** (`template.runbookId`). The anti-join matches on `runbookId + resourceId`, so a fresh ID would find zero executions and report every qualifying interval as a miss. Reusing the configured ID is what makes the comparison meaningful. Don't "fix" this by minting new IDs.

Structured outputs (`output_config.format`) mean the raw response is already schema-valid, but `parseGenerated()` re-validates independently — deliberately, so the check survives a change of schema, model, or transport.

### Key handling — the constraint that shapes this

Vite inlines every `VITE_`-prefixed variable into the bundle as a plain string literal. A key present at build time is published in readable JavaScript. Consequences, all load-bearing:

- The Pages workflow supplies no key, and carries a comment saying so. Don't add one.
- No key → `isDemoMode`, which replays `src/data/recordedResponses.js` instead of calling the API. This is how the deployed build runs.
- Recordings are bound to an FNV-1a hash of the exact template text. Edit a template and its recording stops matching — intended. Re-record with `npm run record`.
- `generate.js` guards its `import.meta.env` access with `?.` and uses explicit `.js` import extensions, because `scripts/record-fixtures.mjs` imports the prompt spec from it under plain Node. Both are required; don't tidy them away.
- The browser client passes `apiKey` explicitly, which short-circuits the SDK's credential chain before it touches the `node:fs` imports Vite externalizes. Those build warnings are expected and harmless.

The checked-in recordings are hand-written placeholders, not live captures; `FIXTURES_ARE_SYNTHETIC` is true and the UI says so. `npm run record` replaces them and clears the flag.

## The dataset

`src/data/events.js` generates background traffic from a fixed-seed LCG (`lcg(20260806)`) so output is byte-for-byte reproducible across reloads and machines. `executionLog.js` uses its own seed (`lcg(77712024)`) and is built from the `episodes` export of `events.js` — deliberately *not* re-derived through the detector, so the log stays an independent record.

Because both generators consume a single sequential PRNG stream, **any edit to generation order or call count reshuffles the whole dataset** and changes the miss count. Planted cases are written out literally below the generator and are safe to edit in place.

Current expected output: 335 events / 60 resources / 14 days (2026-07-23 → 2026-08-06), 1,005 evaluations, 54 expected, 41 logged, **13 misses at 24.1%**. If a change moves these numbers, that is the signal to check what you broke.

### Planted cases — two are intentionally strange

Full table is in `README.md`. Two need care:

- **`REQ-04` (detector error)** — RB-003 *did* fire, 14 minutes after the interval closed; tolerance allows 12. This is a **false positive of this tool**, present on purpose and deliberately **not** labelled as suspect in the UI. Do not "fix" it by widening the tolerance or special-casing the row.
- **`SVC-03` (logic gap)** — sat 40 minutes in `unresponsive_degraded`, which is not RB-001's exact `triggerState` of `unresponsive`. **Absent from the report by design** — exact string matching means this detector is as blind to it as the platform was. Do not add fuzzy or prefix state matching to make it appear.
