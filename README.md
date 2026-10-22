# OpsAudit

**Finding what operations automation silently misses, and putting a price on it.**

**Live demo:** https://dstew2816.github.io/ops-audit/

This is a demo of the kind of work I did at TSMC. Everything is synthetic data, except the clearly labeled public-data check in the Real Data tab.

---

## The problem

Automated procedures in an operations network watch for a condition ("a port has been blocked for 30 minutes") and act on it. They run on live events with no historical replay. If the platform is down, an event arrives late, or a rule is a little too narrow, the case is never picked up and nothing records that it was missed. Success metrics are calculated over the cases that were handled, so a procedure can report 100% while missing a quarter of what it should have caught.

## Who it is for

- **Operations and program managers** who own automated procedures and need to know what they are not catching, what it costs, and which fix to do first.
- **Automation and process engineers** who write the detection logic and maintain it as documents drift.

## What it does

| Layer | What it answers | Where |
|---|---|---|
| **Audit** | What should have been picked up, and what was missed? | Audit tab |
| **Network** | How do batches move between stations, and where do they wait? | Network tab |
| **SPC** | Is each station in control and capable, and are stations that should agree drifting apart? | SPC tab |
| **Impact** | How many labor hours and how much cost does this put at risk, and which fix first? | Impact tab |
| **ML** | Can a model read a messy procedure definition and say what kind of check it is and what exactly it watches? | ML tab |
| **Real data** | Do the ideas hold up on a public, real dataset? | Real Data tab |
| **AI layers** | Can a language model write the detection logic from a document, and group misses by root cause? | AI Layers tab |

## Data

All synthetic and deterministic (seeded generators, so every run gives the same data): a 14-day window, 1,997 rows across 13 tables in an in-browser SQLite database. The one exception is the public dataset described under Real-data validation.

- Seven automated procedures covering six kinds of detection: an interval in a state, a countdown to a deadline, unplanned downtime, a missing field, an expected event that never happened, and a retry counter.
- A seven-station route (Intake, Prep, Process on two parallel lanes, Verify, Pack, Release) with 24 batches, 144 station visits and 120 handoffs.
- 1,050 cycle-time readings for statistical process control, with a few planted problems.
- 1,650 deliberately messy procedure definitions (50 per specific check, in English, German, Spanish and Japanese) for the ML layer.

Planted cases include one six-hour platform outage, bypasses (for example a port in maintenance mode), and cases built to look like they belong together when they do not.

## Approach and results

**Audit.** Rebuild what each procedure should have picked up from raw history, then anti-join against what it logged. Seven hand-written baseline queries are the answer key.
*Result: 92 qualifying cases, 68 logged, **24 missed (26.1%)**.* A miss means the case was never picked up, whatever happened afterward. The check fails if any procedure returns zero misses, because a query that finds nothing looks the same as one that is broken.

**Statistical process control.** X-bar/R and individuals charts, Cp/Cpk/Pp/Ppk, Western Electric and Nelson run rules, and a control chart on the difference between the two parallel Process lanes. Control limits come from a healthy baseline (the first 15 subgroups) and are then held fixed. Setting them from all the data lets a drift drag the centre line toward itself.
*Result: a gradual drift planted at subgroup 15 in lane B alarmed at subgroup 18; the lane-difference chart flagged it at 22. A one-subgroup spike at ST-4 produced exactly one alert. ST-3B's Cpk is 1.48 but its Ppk is 1.18, which is capable when stable but did not stay stable. One healthy station raised a single chance alert, which is expected with 30 points and six rules.*

**Impact model.** Each miss becomes labor hours and cost at risk, then misses are grouped into fixes and ranked by cost, hours or payback. Every input is an editable assumption on the page, set low on purpose.
*Result under the default assumptions: 24 misses is about **17.6 labor hours and $3,618 at risk** in 14 days. The top fix, an outage backfill, covers 8 misses and about half the cost ($1,833).* The annualised figure (about $94,000) just scales the window and should not be read as a forecast.

**ML classifier.** A Python pipeline (pandas, scikit-learn) reads a messy procedure definition and works out two things: the *kind* of check it is (interval, state, missing data, absent event, count, countdown) and the *specific thing* it watches (33 of them, such as queue time, time since PM, OOC alert left open, OOS result with no decision, a hold with no owner, or repeated autoload failures). 1,650 synthetic records, 50 per specific type. One stratified 75/25 split, tuning by 5-fold cross-validation on the training set only, and the 413-record test set scored once. Branching hand-written keyword rules (decide the kind, then the specific thing) are the baseline, frozen before any model was trained and scored on the same test set.
*Result on the test set: the decision tree names the specific thing **79.9%** of the time (kind of check: 86.0%), against 56.4% for the hand rules with English keywords and 66.3% with multilingual keywords. A random forest reaches 89.1%. Always guessing the most common class scores 2.9%.* The tree's cross-validation accuracy was 77.7% (± 2.5%). Its 95% interval (75.8% to 83.5%) does not overlap either rule set's. Thresholds overlap between types and carry noise, and no single feature gives the answer away: the most important feature carries 7.4% of the tree's importance, the best single feature alone scores 11.6% (chance is 3.0%), and removing the threshold and condition features changes the tree's cross-validated accuracy by less than a point. All methods do far worse on deliberately vague records (tree 31.9%, English rules 34.0%).

**Real-data validation.** Everything above is synthetic, so I also ran the same ideas on a public, real dataset: UCI SECOM, 1,567 production runs from a semiconductor process with 590 anonymized sensors and a pass/fail label (104 failures, 6.6%). Individuals charts with limits fixed from an early baseline, a time-split classifier scored on precision, recall and PR-AUC, and a bridge back to the audit's "silent miss" idea.
*Result, reported as it came out and weak: the control charts as built do not separate failures from passes. After the baseline, 95.0% of failing runs were flagged, but so were 98.8% of passing runs. Every classifier scored PR-AUC 0.06 to 0.07 on the later runs, against 0.055 for no skill, with intervals that include it.* Cpk and Ppk are not reported, because the sensors are anonymized and no specification limits exist. See the Real Data tab and `ml/README.md`.

**AI layer 1: documents to detection logic.** Three separate model calls (resolve the procedure, extract the condition, compose the SQL), graded against the hand-written baselines on resolution, execution, row counts, the rows themselves and structure.
*Result, one run: the right procedure resolved **5 of 5**; **2 of 5** matched the baseline exactly.* One document produced SQL that found three extra holds (blank rather than empty department, which arguably beats the baseline). One returned 36 rows against 4 because the extraction stage counted from the end of the window instead of from each batch's own latest event, and that error is visible before any SQL is written, which is why the work is split in three. One never produced runnable SQL.

**AI layer 2: root-cause grouping.** One model call over all 24 misses, graded against a hand-written diagnosis built to reward the right answer and punish a plain group-by-time.
*Result, one run: **3 of 5 checks passed**. It recovered the outage cluster exactly (8 misses, one infrastructure cause), but blamed the outage for a hold that has no time component, grouped two missed checks that only looked alike, and called one miss unexplained that the key explains.*

## How it is checked

```
npm run db:check                    # the data and the 24 planted misses
npm run spc:check                   # SPC math, run rules, planted problems
npm run impact:check                # totals reconcile, assumptions move results correctly
npm run gen:check -- --self-test    # generation scorer, no API calls
npm run diag:check -- --self-test   # diagnosis scorer, no API calls
python ml/train.py                  # the ML pipeline (see ml/README.md)
python ml/real/download_secom.py    # fetch the public SECOM data (not committed)
python -I ml/real/secom_analysis.py # real-data SPC, classification and bridge
```

Every scorer is tested to fail: the self-tests feed deliberately wrong answers through and require them to be rejected. The live AI runs need an API key in the environment and are recorded with `--save`; the browser never holds a key.

## Limitations

- **Synthetic data, small sample.** 24 misses, 7 stations, one 14-day window, a 413-record ML test set, one run of each AI layer. Treat the numbers as a demonstration of method, not a benchmark or a forecast.
- **I wrote the answer keys.** The baselines, the diagnosis key, the ML generator, its keyword lists and its hand rules share one author's vocabulary. Real documents would be harder, and the ML numbers lean optimistic.
- **The ML data is synthetic and I wrote all of it.** The taxonomy, the generator, the keyword lists and the hand rules share one author's vocabulary, so real documents would be harder and the accuracy leans optimistic. Vague records (a generic title and description) are hard for every method, and the learned tree does no better than the hand rules on them.
- **A smaller ML run came first.** An earlier version with 30 records per type was run once during development. The final version follows a fixed checklist (at least 50 per type, noisier thresholds, a feature-dominance check, a full confusion matrix) rather than anything tuned to test scores, and only the final run is reported.
- **The real-data result is weak, and the sensors are anonymized.** On SECOM the charts flag nearly every run (the sensors are not stable even inside the baseline), no model clearly beats chance on the later runs, and there are no specification limits, so capability is not reported. There are only 104 failures, 26 of them in the test period, so every interval is wide. A plain individuals chart assumes roughly independent, normal readings, which these are not, and I did not correct for that.
- **The impact model is assumptions, not measurements.** The labor rate, the chance a miss causes real cost and the dollar consequences are illustrative and editable.
- **The AI runs are one sample each.** A different run could score differently. The first stage's prompt was changed once before the recorded run, to stop the API refusing a request to explain its own reasoning, and nothing was changed after seeing scores.

## Data sources and credits

- **UCI SECOM** (Real Data tab, `ml/real/`): McCann, M. & Johnston, A. (2008). SECOM [Dataset]. UCI Machine Learning Repository. https://doi.org/10.24432/C54305. Licensed under CC BY 4.0. The raw files are not committed; `python ml/real/download_secom.py` fetches them. The results file includes the readings of 8 charted sensors as derived data, credited to the source.
- Everything else in this project is synthetic and generated by the code in this repository.

## Where else this applies

Anywhere automation acts on conditions it detects in real time: warehouse and fulfillment networks, supplier and carrier integrations, service-desk and IT operations runbooks. The cases an automation never picked up are not in its denominator, and nobody checks.

## Built with

JavaScript, React, Vite and SQLite (sql.js) for the app; Python, pandas and scikit-learn for the ML layer; Claude (Anthropic API) for the two AI layers. Built with an AI coding assistant. I designed the problem, the answer keys, the evaluation approach and the planted test cases. `guide.md` documents the architecture.
