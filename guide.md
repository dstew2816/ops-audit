# guide.md

This file gives an AI coding assistant the context it needs to work in this repository without breaking the design decisions that the checks depend on. The README is the better starting point for a human reader.

## Commands

```
npm install
npm run dev                          # http://localhost:5173
npm run build                        # static output in dist/ (gitignored)
npm run preview                      # serve the built output
npm run check                        # every check below that needs no API key
npm run db:check                     # build the SQL layer under Node and verify it against the planted ground truth
npm run spc:check                    # verify the statistical process control (SPC) math and the planted problems
npm run impact:check                 # verify the impact model
npm run gen:check -- --self-test     # prove the query-generation scorer, no API calls
npm run diag:check -- --self-test    # prove the diagnosis scorer, no API calls
python ml/ci_smoke.py                # the fast machine learning check that continuous integration runs
```

The live runs of the two AI layers (`npm run gen:check -- --only ASOP-114` and `npm run diag:check`) need an API key and make real calls. The saved results in `src/ai/results/` come from one recorded run, so do not repeat the live runs unless the user asks for it.

There is no test runner, linter or type checker. Verification is the set of check scripts above plus reading the numbers on the site. `src/db/` is verified by `db:check`, the SQL generation layer by `gen:check`, the diagnosis layer by `diag:check`, and each of the SPC and impact modules by its own script.

Pushing to `main` runs `.github/workflows/ci.yml` (all checks, the build and the ML smoke test) and `.github/workflows/deploy.yml`, which builds `dist/` and publishes it to GitHub Pages. `vite.config.js` sets `base: './'` so the build works from any Pages subpath, and that should not be changed to an absolute base.

## What this is

OpsAudit is a React 19, Vite and Tailwind v4 single-page app with no backend and no router. The whole data layer is a real SQLite database built in the browser with sql.js from seed rows in `src/db/seed/`. The site has four views, defined in `src/App.jsx`: Summary, Audit and cost, Monitoring and models, and Real-data check. Audit and cost holds the audit, the impact model and the station network. Monitoring and models holds the SPC charts, the classifier and the two AI layers. Pages that used to be their own tabs are routed into these four views by the `ROUTE` map.

The premise is that an operations automation platform is event-driven and has no historical replay. If it is down when a trigger condition opens, or an event arrives after the condition has cleared, nothing fires and nothing is recorded in the system that failed. This app is the independent reconciliation pass that reconstructs what should have happened and anti-joins it against what did.

Earlier versions had a second, IT-themed dataset with a JavaScript detector. It was retired when the project became OpsAudit, and the SQL layer replaced it completely.

## The SQL data layer (`src/db/`)

This is a real SQLite database built in the browser with sql.js, and it is the only data layer. Every view reads it, and the audit result of 92 qualifying cases, 68 logged and 24 missed (26.1%) comes from the seven baselines in `baselines.js`. The expected totals are 13 tables and 1,997 rows, and `npm run db:check` fails if a change moves any of the counts.

Two engine modules import this layer, both by design and both in the same direction. `src/engine/` depends on `src/db/`, and `src/db/` never imports `src/engine/`. `generate-sql.js` takes the roster of automated procedures and the schema definitions from the seed layer, and `score.js` takes the query runner, the baselines and the house rules. In the code an automated procedure is called an ASOP, and the identifiers such as ASOP-114 appear in the data, the queries and the saved results, so they are left as they are.

There are six candidate tables with genuinely different schemas and time semantics (interval, countdown, unplanned window, null check, absence and retry chain), because a real platform runs many automations that each target a different kind of candidate.

Some rules for working in this layer:

- `build.js` takes an already-initialized sql.js module and does not initialize one itself, because the browser and Node locate the WebAssembly file differently. `client.js` does it one way and `scripts/db-check.mjs` does it the other way. That separation should stay, since the Node harness is the only verification this layer has.
- The WebAssembly file is imported with Vite's `?url`, so it is emitted as a hashed asset referenced relatively. `base: './'` depends on that, so never hardcode a path.
- Each seeder uses its own random generator instead of one shared stream, so editing one seeder cannot reshuffle another table.
- `asop_activity_log` contains only candidates that were picked up. Never add rows that represent failures to detect, because the absence of those rows is the premise of the audit. The `outcome` column is recorded and must stay unused by detection.
- The anti-join needs `json_extract(selection_payload, '$.<key>')` with a key that depends on the procedure type, scoped by `asop_id`, because `$.tool_id` and `$.batch_id` each appear in more than one payload shape.
- Three `hold_records` rows carry `dept_code = ''` or `'   '`. They are the same defect as a null value but are invisible to `IS NULL`, and they are absent from the report by design, so the condition should not be widened to catch them.

### Baselines (`src/db/baselines.js`)

These are seven hand-written detection queries, one per procedure. Each carries its own metadata and is the full detection: it evaluates the candidates in their own shape, applies configs and bypasses, anti-joins against the log scoped by `asop_id`, and returns the misses. They are the ground truth that generated SQL is compared against, and `npm run db:check -- --print-sql` prints them.

- The queries should not be factored together. There is no shared template, no common duration helper and no base common table expression. If two of them look similar, that says something about the problem and is not duplication to remove. ASOP-114 and ASOP-118 are near-identical on purpose, with the same table and a different state and threshold, and that pair is the reason resolution cannot stop at "which table".
- A config decides what qualifies, while a bypass is attributed onto a qualifying row and never suppresses it. ASOP-233's `scheduled = 1` is a config, and ASOP-402's `skip_reason` is a bypass.
- A bypassed miss is still returned, with its reason attributed. A bypass belongs in the SELECT list as a `CASE` expression and never in a `WHERE`, because suppressing those rows would make this pass inherit the blind spot of the system it audits. `db:check` enforces this: every baseline's outer filter must be exactly `WHERE l.log_id IS NULL`, every declared bypass must appear as `CASE WHEN q.<column>`, and bypassed and unbypassed misses are counted and printed separately so that a category dropping to zero is visible. Those predicates live in `src/db/house-rules.js` and are imported by all three callers, which are `db-check.mjs` on the baselines, `generate-sql.js` on generated SQL before it runs, and `score.js` on it afterwards. Do not reimplement one inline, because three private copies would each keep passing their own version of the rule.
- ASOP-341 takes no `$end` parameter and has no `platform_status` join, because its shape has no time dimension, and one should not be added for symmetry.
- `db:check` fails any procedure that returns zero misses, because a detection query that finds nothing proves nothing.

## The SQL generation layer

`src/engine/generate-sql.js` takes messy procedure documentation (`src/db/templates.js`, five of the seven procedures) through three model calls and produces executable detection SQL. It is a harder problem than extracting a small definition that an existing detector consumes, because this layer has to produce the detector itself.

It uses three stages because they fail differently, as documented at the top of the module. The first stage resolves which procedure the document is about, from the roster only. The second extracts what the condition is, from the document plus the raw schema. The third composes the SQL from the extracted spec alone. Several details matter:

- Stage 3 never sees the document. The spec is the entire interface, so anything stage 2 missed cannot reappear by luck, and that is what makes stage 2 falsifiable.
- Ground truth never enters a prompt. Nothing in `generate-sql.js` imports `baselines.js`, the roster is projected down to id, name, sponsor and department, and the schema is `CREATE TABLE` text with no commentary.
- The resolved procedure id is the anti-join scope. Because `$.tool_id` appears in three payload shapes and `$.batch_id` in two, a wrong resolution does not produce a near miss. It matches no log rows and reports a 100% failure rate.
- Bypasses invert on the way in. Documents state them as suppression, because that is what they are in the automation, and `parseComposed()` rejects SQL that filters on one.
- `callStageLive` takes an injectable `client` and `generateSql` takes an injectable `call`, because the key comes from `import.meta.env`, which is empty under Node. `gen-check.mjs` supplies its own transport and runs the same chain, and the chain should not be copied into the script.

### Scoring (`src/engine/score.js`) and `npm run gen:check`

`score.js` is pure, with no model, no network and no environment, and everything is an argument. It scores a generated candidate against its baseline on five dimensions that fail separately: resolution, execution, counts, rows and structure.

- Counts and rows are separate on purpose. Seven misses when there should be seven, but a different seven, scores perfectly on counts. Only identity comparison on `baseline.antiJoinKeys` with the `$.` stripped catches that, and output that lacks those identifier columns is itself a reported failure and not a skipped check.
- Structure is scored even when the numbers are right. A query that never extracted a bypass returns the same rows with the reason missing, which gives the right count and the right identities but loses the attribution, and only the text shows that.
- A wrong resolution is still scored against the expected baseline, which is what turns it into a visible pile of extras.

`scripts/gen-check.mjs` runs only in Node, live, with no interface. It reads the key from `ANTHROPIC_API_KEY` or `VITE_ANTHROPIC_API_KEY` (or `.env`), and when neither is present it names both and exits with code 1 instead of pretending. Its flags are `--only <ASOP|TPL>`, `--print-sql`, `--stages` and `--self-test`.

- `--self-test` runs first and costs nothing. It feeds each baseline's own SQL back through the scorer, which must score perfectly on all five dimensions and find a non-zero number of misses. Until it passes, a scoring bug and a generation bug are indistinguishable, and all seven pass today.
- The script sets `process.exitCode` and does not call `process.exit()`. On Windows, exiting while the SDK's keep-alive socket is closing trips a libuv assertion that aborts and replaces the exit code with its own, which would mean a check whose verdict is discarded by its own exit path, so this should not be changed back.
- Live runs make real calls, three per template, so they should be scoped with `--only` unless a full sweep is actually wanted.

## The diagnosis layer

`src/engine/diagnose.js` answers the question that the baselines leave open. The baselines say which candidates were missed, and this layer says which of them share a cause and what that cause is.

Grouping is the judgement being tested, so it is one model call and not a chain. Splitting it into a "group" step and a "classify" step would let the second call rationalize the first one's grouping and not test it.

- It is a model call and not a rules pass, deliberately. Rules that discriminate these clusters would be easy to write because they would be written knowing what was planted, and reproducing a planted answer proves nothing. The argument for a model is that the failure modes of a large set of automations cannot be enumerated in advance, which only holds if these have not been enumerated as rules either. `src/db/expected-findings.js` is therefore literal data, in the same way `baselines.js` is seven literal queries.
- `src/db/cause-classes.js` exists so that `diagnose.js` never imports the answers. Both sides need the list of cause classes, and only the scorer may see the findings, which is the same rule as `generate-sql.js` never importing `baselines.js`.
- `unexplained` is a sixth class and it matters. A layer forced to pick one of five causes for every miss will manufacture one, and two misses are pinned clear of every cluster precisely so that a diagnosis has to be willing to say it.
- Misses on ASOP-341 and ASOP-455 carry no platform status, because their baselines join none, and one should not be attached for symmetry, since that would fabricate the evidence the trap described below turns on.
- The live call is streamed. The SDK refuses a non-streaming request whose `max_tokens` implies it could run longer than ten minutes, and `.finalMessage()` hides that, so the answer is not to cut the budget.

### What the data was built to discriminate

These cases were planted in commit `376801d`, and they are the reason this layer is scored at all.

- Cluster A is 8 misses across ASOP-114, 207, 233 and 402 inside the 6-hour platform outage (PW-004), with one cause and one fix.
- The in-window trap is 4 more misses inside that same window, on ASOP-341 and ASOP-455. Those detections have no time predicate at all, so the outage cannot explain them. The evidence that says so is structural (`timePredicate: 'none'` and no `platform_status` join) and not temporal, and it appears in the bundle as plain fact with nothing said about what follows from it.
- Cluster B is 3 misses in 73 minutes on 2026-07-23 with the platform up, and it needs three separate findings: `C-034` (a bypass scoped too broadly), `M-0062` (a criterion narrower than stated) and `T-23` (38 minutes, which is over the current threshold of 30 and under the 60 it was revised down from). It is tighter in time than cluster A and completely unrelated, which is the opposite of what clustering on time predicts. Two of the three are `configuration` for different reasons, so grouping by class fails here too.
- Threshold history is present on ASOP-114, 233 and 402, and only ASOP-233's change went unapplied, so its presence is not by itself evidence.

### Scoring (`src/engine/diagnose-score.js`) and `npm run diag:check`

The scorer is pure, with no model, no network and no database. It has five dimensions that fail separately: coverage, outage, trap, coincidental and standAlone.

- `outage` and `trap` are split for a specific case. A layer that reports the correct 8 plus a second infrastructure finding holding the other 4 scores perfectly on `outage` and still believes the outage caused them, and only `trap` sees that.
- Prose is never scored. The `title`, `cause` and `evidence` fields are not comparable, and scoring wording would reward paraphrasing the ground truth. What is scored is which misses were grouped and what class the group received.
- 17 of the 24 misses have no positive expectation, and that is deliberate. Nothing was planted about them, so scoring them would invent ground truth. Singletons and trap misses are scored negatively only, meaning they must not be absorbed into another finding and nothing else is required of them.

`--self-test` runs first, costs nothing, and has four parts. The third matters most: 7 deliberately broken diagnoses, each declaring exactly which dimensions must go red, asserted as an exact set. A scorer that passes its own ground truth proves little on its own, because one that returns `ok` for everything passes that too. The case named `over-merged` is the headline, with all 12 in-window misses as one finding and cluster B as another, which is the answer that a `GROUP BY` on time produces. A scorer that cannot reject it cannot tell a diagnosis from a sort. The script sets `process.exitCode` and does not call `process.exit()`, for the same Windows libuv reason as `gen-check.mjs`.

## The SPC layer (`src/spc/`, Monitoring and models view)

`src/spc/spc.js` holds pure functions for X-bar/R and individuals (I-MR) limits, the capability indices Cp, Cpk, Pp and Ppk, the Western Electric rules 1 to 4 and Nelson rules 5 and 6, and cross-station drift (`pairDrift`, a control chart on the difference between two stations that should agree). Limits are set from the first 15 subgroups (`BASELINE`) and held fixed, because setting them from all of the data lets a drift pull the centre line toward itself.

The data is in `station_specs` and `station_measurements` (7 stations, 30 subgroups and 5 readings each, which is 1,050 rows), seeded in `src/db/seed/measurements.js`. The planted problems are that ST-3B drifts upward from subgroup 15, and that ST-4 has a one-subgroup spike at subgroup 22 and a wide spread (Cpk about 1.1). `npm run spc:check` verifies the math against hand-worked answers, that each rule fires on a constructed pattern, that the planted problems are found, and that healthy stations stay quiet. ST-3A raises one chance alert, which is expected with 30 points and six rules and is reported and not hidden.

## The impact model (`src/impact/`, Audit and cost view)

`impact.js` converts misses into labor hours and cost at risk and ranks fixes. Every input is an assumption (the labor rate, the chance that a miss causes real cost, the manual hours and consequence per procedure, the bypass weight and the fix effort by cause class), and the defaults are deliberately low and editable on the page. A fix is one finding from `expected-findings.js`, which is the hand-written diagnosis, so the page groups misses by the answer key. The live diagnosis could supply that grouping instead, but it has not been wired in. `misses.js` collects miss records from the baselines, and `miss-id.js` is shared with `diagnose.js` so that browser code never imports the model SDK. `npm run impact:check` verifies that every miss lands in exactly one fix, that the totals reconcile three ways, and that the math moves in the right direction when assumptions change.

## The ML layer (`ml/`, Monitoring and models view)

This is Python (pandas and scikit-learn), separate from the JavaScript app. A two-level taxonomy of 6 kinds and 33 specific types in `ml/taxonomy.py` drives the data generator, and the features and the hand rules never import it. `python ml/generate_data.py` and then `python ml/train.py` write `ml/results/results.json`, which `src/components/MlTab.jsx` imports directly, so there is no Python at runtime. The default `python` on the author's machine lacks the libraries, so use an environment that has the packages in `ml/requirements.txt`. The protocol is one stratified split, tuning by cross-validation on the training set only, and the test set used once. The hand rules in `ml/rules.py` are frozen and must not be tuned against test results. `ml/README.md` has the full detail.

## The real-data layer (`ml/real/`, Real-data check view)

The data is UCI SECOM (CC BY 4.0, McCann & Johnston 2008), downloaded by `ml/real/download_secom.py` into the gitignored `ml/real/data/`. `python -I ml/real/secom_analysis.py ml/real/data/secom` writes `ml/real/results/secom_results.json`, which `RealDataTab.jsx` imports. All of the choices (the time split, the 300-run baseline, the 8 sensors selected without using the label, the look-back window and no tuning on the test period) are fixed in the script header and must not be changed after seeing results, and whatever comes out is reported. It runs in isolated mode (`-I`) because it reads downloaded files. Cpk and Ppk are deliberately not reported, because the data has no specification limits. The result is weak and should stay described as weak, and the work is called a stress test and never a validation.
