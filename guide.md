# guide.md

This file provides guidance for ai assist when working with code in this repository.

## Commands

```
npm install
npm run dev      # http://localhost:5173
npm run build    # static output in dist/ (gitignored)
npm run preview  # serve the built output
npm run db:check # build the SQL layer under Node and verify it against the planted ground truth
npm run gen:check -- --self-test   # prove the scorer, no API calls
npm run gen:check -- --only ASOP-114   # one template end to end, live, needs a key
npm run diag:check -- --self-test  # prove the diagnosis scorer, no API calls
npm run diag:check                 # diagnose all 24 misses, live, one call, needs a key
```

There is no test runner, linter, or type checker configured. Verification is by running the app and reading the numbers on the Audit tab — except for `src/db/`, which `npm run db:check` verifies on its own, and the SQL generation layer, which `npm run gen:check` scores against it.

Push to `main` triggers `.github/workflows/deploy.yml`, which builds and publishes `dist/` to GitHub Pages. `vite.config.js` sets `base: './'` so the build works from any Pages subpath — don't change that to an absolute base.

## What this is

React 19 + Vite + Tailwind v4 single-page app, no backend, no router. The whole data layer is a real SQLite database built in the browser with sql.js from seed rows in `src/db/seed/`. Two tabs today: Audit (coverage and misses per automated procedure) and Network (stations, dwell, handoffs).

The premise: an operations automation platform is event-driven with no historical replay. If it is down when a trigger condition opens, or an event arrives after the condition cleared, nothing fires and nothing is recorded in the system that failed. This app is the independent reconciliation pass that reconstructs what should have happened and anti-joins it against what did.

Earlier versions had a second, IT-themed dataset (services, tickets, requests) with a JavaScript detector. It was retired when the project became OpsAudit; the SQL layer replaced it completely.

## The SQL data layer (`src/db/`)

A real SQLite database built in the browser with sql.js. It is the only data layer: every tab reads it, and the
audit result (92 qualifying, 68 logged, 24 missed, 26.1%) comes from the seven baselines in `baselines.js`.

Two engine modules do import it, both by design and both in the same direction —
`src/engine/` depends on `src/db/`, never the reverse. `generate-sql.js` takes
the ASOP roster and the schema DDL from the seed layer, and `score.js` takes the
query runner, the baselines and the house rules. Nothing in `src/db/` imports
`src/engine/`.

Six candidate tables with genuinely different schemas and time semantics
(interval / countdown / unplanned-window / null-check / absence / retry-chain),
because the real system has ~200 automations each targeting a different
candidate type. Full table in `README.md`.

- **`build.js` is environment-free** — it takes an already-initialised sql.js
  module rather than initialising one, because the browser and Node locate the
  WASM differently. `client.js` does it one way, `scripts/db-check.mjs` the
  other. Keep it that way; the Node harness is the only verification this layer
  has.
- **The wasm is imported with Vite's `?url`** so it is emitted as a hashed asset
  referenced relatively. `base: './'` depends on that — never hardcode a path.
- Seeders use **one generator each**, not one shared stream. Editing one seeder
  cannot reshuffle another table.
- `asop_activity_log` contains only candidates that were picked up. **Never add
  rows representing failures to detect** — the absence is the premise. `outcome`
  is recorded and must stay unused by detection.
- The anti-join needs `json_extract(selection_payload, '$.<key>')` with a
  type-dependent key, scoped by `asop_id`: `$.tool_id` and `$.batch_id` each
  appear in more than one payload shape.
- **3 `hold_records` rows carry `dept_code = ''` or `'   '`.** Same defect as
  NULL, invisible to `IS NULL`, absent from the report by design — the direct
  counterpart of `SVC-03`. Don't widen the condition to catch them.

Expected: 669 rows / 8 tables, 92 candidates, 68 logged, **24 misses at 26.1%**.
`npm run db:check` fails if a change moves any of it.

### Baselines (`src/db/baselines.js`)

Seven hand-written detection queries, one per ASOP, each carrying its metadata
and each being the full detection: candidate evaluation in its own shape,
configs and bypasses applied, anti-join scoped by `asop_id`, returning misses.
Ground truth for diffing generated SQL. `npm run db:check -- --print-sql` dumps
them.

- **Do not factor these together.** No shared template, no common duration
  helper, no base CTE. If two look similar that is information about the
  problem, not duplication to remove. ASOP-114 and ASOP-118 are near-identical
  on purpose — same table, different state and threshold — and that pair is the
  reason resolution cannot stop at "which table".
- A **config** decides what qualifies; a **bypass** is attributed onto a
  qualifying row and never suppresses it. `ASOP-233`'s `scheduled = 1` is a
  config. `ASOP-402`'s `skip_reason` is a bypass.
- **A bypassed miss is still returned, with its reason attributed.** A bypass
  belongs in the SELECT list as a `CASE` expression, never in a `WHERE` —
  suppressing those rows would make this pass inherit the blind spot of the
  system it audits. `db:check` enforces it: every baseline's outer filter must
  be exactly `WHERE l.log_id IS NULL`, every declared bypass must appear as
  `CASE WHEN q.<column>`, and bypassed and unbypassed misses are counted and
  printed separately so a category dropping to zero is visible. Those predicates
  live in **`src/db/house-rules.js`** and are imported by all three callers —
  `db-check.mjs` on the baselines, `generate-sql.js` on generated SQL before it
  runs, `score.js` on it afterwards. Don't reimplement one inline; three private
  copies would each keep passing their own version of the rule.
- `ASOP-341` takes no `$end` parameter and has no `platform_status` join,
  because its shape has no time dimension. Don't add one for symmetry.
- `db:check` fails any ASOP returning **zero misses** — a detection query that
  finds nothing proves nothing.

### Planted cases — two are intentionally strange

Full table is in `README.md`. Two need care:

- **`REQ-04` (detector error)** — RB-003 *did* fire, 14 minutes after the interval closed; tolerance allows 12. This is a **false positive of this tool**, present on purpose and deliberately **not** labelled as suspect in the UI. Do not "fix" it by widening the tolerance or special-casing the row.
- **`SVC-03` (logic gap)** — sat 40 minutes in `unresponsive_degraded`, which is not RB-001's exact `triggerState` of `unresponsive`. **Absent from the report by design** — exact string matching means this detector is as blind to it as the platform was. Do not add fuzzy or prefix state matching to make it appear.

## The SQL generation layer

`src/engine/generate-sql.js` is the counterpart of `generate.js` for the SQL
layer, and a harder problem: `generate.js` extracts a small definition an
existing detector consumes, this one has to produce the detector. Messy ASOP
documentation (`src/db/templates.js`, five of the seven ASOPs) → three model
calls → executable detection SQL.

Three stages because they fail differently, documented at the top of the module:
**resolve** (which ASOP, roster only), **extract** (what the condition is,
document plus raw schema), **compose** (write the SQL, from the extracted spec
alone). Load-bearing details:

- **Stage 3 never sees the document.** The spec is the entire interface, so
  anything stage 2 missed cannot reappear by luck. That is what makes stage 2
  falsifiable.
- **Ground truth never enters a prompt.** Nothing in `generate-sql.js` imports
  `baselines.js`. The roster is projected down to id, name, sponsor, department;
  the schema is CREATE TABLE text with no commentary.
- **The resolved ASOP id is the anti-join scope.** `$.tool_id` appears in three
  payload shapes and `$.batch_id` in two, so a wrong resolution does not produce
  a near miss — it matches no log rows and reports 100% failure.
- **Bypasses invert on the way in.** Documents state them as suppression because
  that is what they are in the automation. `parseComposed()` rejects SQL that
  filters on one.
- `callStageLive` takes an injectable `client` and `generateSql` an injectable
  `call`, because this module's key comes from `import.meta.env`, which is empty
  under Node. `gen-check.mjs` supplies its own transport and runs the same
  chain. Don't answer that by copying the chain into the script.

### Scoring (`src/engine/score.js`) and `npm run gen:check`

`score.js` is pure — no model, no network, no environment, everything an
argument. It scores a generated candidate against its baseline on five
dimensions that fail separately: **resolution**, **execution**, **counts**,
**rows**, **structure**.

- **Counts and rows are separate on purpose.** Seven misses when there are seven
  but a different seven scores perfect on counts. Only identity comparison —
  on `baseline.antiJoinKeys` with `$.` stripped — catches it. Output that lacks
  those identifier columns is itself a reported failure, not a skipped check.
- **Structure is scored even when the numbers are right.** A query that never
  extracted a bypass returns the same rows with the reason missing: right count,
  right identities, attribution gone. Only the text shows that.
- **A wrong resolution is still scored against the expected baseline.** That is
  what turns it into a visible pile of extras.

`scripts/gen-check.mjs` is Node-only, live, no UI. Key from
`ANTHROPIC_API_KEY` or `VITE_ANTHROPIC_API_KEY` (or `.env`); absent, it names
both and exits 1 rather than pretending. Flags: `--only <ASOP|TPL>`,
`--print-sql`, `--stages`, `--self-test`.

- **`--self-test` runs first and costs nothing.** It feeds each baseline's own
  SQL back through the scorer, which must score perfect on all five dimensions
  and find a non-zero number of misses. Until it passes, a scoring bug and a
  generation bug are indistinguishable. All seven pass today.
- The script sets `process.exitCode` instead of calling `process.exit()`. On
  Windows, exiting while the SDK's keep-alive socket is closing trips a libuv
  assertion that aborts and replaces the exit code with its own — a check whose
  verdict its own exit path discards. Don't change it back.
- **Live runs cost real calls**, three per template. Scope with `--only` unless
  a full sweep is actually wanted.

## The diagnosis layer

`src/engine/diagnose.js` is the pass the scope boundary above defers. The
baselines answer *which* candidates were missed; this answers *which of them
share a cause* and *what that cause is*. Node-side only so far — no UI.

Grouping is the judgement being tested, so it is **one model call, not a
chain**. Splitting it into "group" then "classify" would let the second call
rationalise the first one's grouping instead of testing it.

- **It is a model call and not a rules pass, deliberately.** Rules that
  discriminate these clusters would be easy to write *because they would be
  written knowing what was planted*, and reproducing a planted answer proves
  nothing. The argument for a model is that ~200 automations' failure modes
  cannot be enumerated in advance — which only holds if these have not been
  enumerated as rules either. `src/db/expected-findings.js` is therefore literal
  data, the same way `baselines.js` is seven literal queries.
- **`src/db/cause-classes.js` exists so `diagnose.js` never imports the
  answers.** Both sides need the enum; only the scorer may see the findings.
  Same rule as `generate-sql.js` never importing `baselines.js`.
- **`unexplained` is a sixth class and is load-bearing.** A layer forced to pick
  one of five causes for every miss will manufacture one. Two misses are pinned
  clear of every cluster precisely so a diagnosis has to be willing to say it.
- Misses on ASOP-341 and ASOP-455 carry **no platform status**, because their
  baselines join none. Don't attach one for symmetry — it would fabricate the
  evidence the trap below turns on.
- The live call is **streamed**. The SDK refuses a non-streaming request whose
  `max_tokens` implies it could exceed ten minutes; `.finalMessage()` hides
  that. Don't answer it by cutting the budget instead.

### What the data was built to discriminate

Planted in `376801d`, and the reason this layer is scored at all:

- **Cluster A** — 8 misses across ASOP-114/207/233/402 inside the 6h outage
  (PW-004). One cause, one fix.
- **The in-window trap** — 4 more misses inside that same window, on ASOP-341
  and ASOP-455. Those detections have **no time predicate at all**, so the
  outage cannot explain them. The evidence that says so is structural
  (`timePredicate: 'none'`, no `platform_status` join), not temporal, and it is
  in the bundle as plain fact with nothing said about what follows from it.
- **Cluster B** — 3 misses in 73 minutes on 2026-07-23, platform `up`, needing
  **three separate findings**: `C-034` (bypass scoped too broadly), `M-0062`
  (criterion narrower than stated), `T-23` (38 min — over the current threshold
  of 30, under the 60 it was revised down from). Tighter in time than cluster A
  and completely unrelated, which is the opposite of what clustering on time
  predicts. Two of the three are `configuration` for different reasons, so
  grouping by class fails here too.
- **Threshold history** is on ASOP-114, 233 and 402 and only ASOP-233's went
  unapplied, so its presence is not by itself evidence.

### Scoring (`src/engine/diagnose-score.js`) and `npm run diag:check`

Pure — no model, no network, no database. Five dimensions that fail separately:
**coverage**, **outage**, **trap**, **coincidental**, **standAlone**.

- **`outage` and `trap` are split for a specific case.** A layer reporting the
  correct 8 *plus* a second infrastructure finding holding the other 4 scores
  perfect on `outage` and still believes the outage caused them. Only `trap`
  sees it.
- **Prose is never scored.** `title`, `cause` and `evidence` are not comparable;
  scoring wording would reward paraphrasing the ground truth. What is scored is
  which misses were grouped and what class the group got.
- **17 of 24 misses have no positive expectation** and that is deliberate.
  Nothing was planted about the other 7, so scoring them would be inventing
  ground truth. Singletons and trap misses are scored **negatively only** —
  they must not be absorbed, and nothing is required about them otherwise.

`--self-test` runs first, costs nothing, and has four parts. The third is the
one that matters: **7 deliberately broken diagnoses, each declaring exactly
which dimensions must go red**, asserted as an exact set. A scorer that passes
its own ground truth proves nothing on its own — one that returns `ok` for
everything passes that too. `over-merged` is the headline: all 12 in-window
misses as one finding and cluster B as another, the answer a `GROUP BY` on time
produces. A scorer that cannot reject it cannot tell a diagnosis from a sort.

The script sets `process.exitCode` rather than calling `process.exit()`, for the
same Windows libuv reason as `gen-check.mjs`.

## The SPC layer (`src/spc/`, SPC tab)

Pure functions in `src/spc/spc.js`: X-bar/R and individuals (I-MR) limits, Cp/Cpk/Pp/Ppk, Western Electric 1-4 and Nelson 5-6 run rules, and cross-station drift (`pairDrift`, a control chart on the difference between two stations that should agree). Limits are set from the first 15 subgroups (`BASELINE`) and held fixed; setting them from all data lets a drift pull the centre line toward itself.

Data: `station_specs` and `station_measurements` (7 stations x 30 subgroups x 5 readings = 1,050 rows), seeded in `src/db/seed/measurements.js`. Planted problems: ST-3B drifts upward from subgroup 15, ST-4 has a one-subgroup spike at 22 and a wide spread (Cpk about 1.1). `npm run spc:check` verifies the math against hand-worked answers, that each rule fires on a constructed pattern, that the planted problems are found, and that healthy stations stay quiet. ST-3A raises one chance alert; that is expected with 30 points and six rules and is reported, not hidden.

## The impact model (`src/impact/`, Impact tab)

`impact.js` converts misses into labor hours and cost at risk and ranks fixes. Every input is an assumption (labor rate, chance a miss causes real cost, manual hours and consequence per procedure, bypass weight, fix effort by cause class); defaults are conservative and editable on the tab. A fix is one finding from `expected-findings.js` (the hand-written diagnosis), so the tab groups misses by the answer key; the live diagnosis (Phase 5) should eventually supply that grouping instead. `misses.js` collects miss records from the baselines; `miss-id.js` is shared with `diagnose.js` so browser code never imports the model SDK. `npm run impact:check` verifies that every miss lands in exactly one fix, totals reconcile three ways, and the math moves the right direction when assumptions change.

## The ML layer (`ml/`, ML tab)

Python (pandas + scikit-learn), separate from the JS app. A two-level taxonomy (6 kinds, 33 specifics) in `ml/taxonomy.py` drives the data generator; the features and the hand rules never import it. `python ml/generate_data.py` then `python ml/train.py` writes `ml/results/results.json`, which `src/components/MlTab.jsx` imports directly (no runtime Python). The Anaconda Python on the dev machine has the libraries; the default `python` does not. Protocol: one stratified split, tuning by CV on train only, test set used once. The hand rules in `ml/rules.py` are frozen; do not tune them against test results. Full detail in `ml/README.md`.

## The real-data layer (`ml/real/`, Real Data tab)

UCI SECOM (CC BY 4.0, McCann & Johnston 2008), downloaded by `ml/real/download_secom.py` into the gitignored `ml/real/data/`. `python -I ml/real/secom_analysis.py` writes `ml/real/results/secom_results.json`, which `RealDataTab.jsx` imports. All choices (time split, 300-run baseline, 8 label-free sensors, look-back window, no tuning on test) are fixed in the script header; do not change them after seeing results, and report whatever comes out. Run it in isolated mode (`-I`) because it reads downloaded files. Cpk/Ppk are deliberately not reported (no specification limits). The result is weak and should stay described as weak.
