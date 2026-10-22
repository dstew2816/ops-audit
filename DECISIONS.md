# Decisions

> **DRAFT. TODO-DAVID:** these entries were drafted by Claude Code from the project's actual history. Rewrite each one in your own words before you rely on it in an interview, and delete anything you can't defend. Every entry follows the same shape: context, decision, alternatives rejected.

## 1. Synthetic data for the audit, plus a real-data stress test

**TODO-DAVID: rewrite in your own words.**

**Context.** The audit needs two independent sources: raw events showing a condition happened, and the automation's own record of what it did. No public dataset has both, and real internal data cannot be shared. Without a known answer there is also no way to tell whether the audit is right.

**Decision.** Generate synthetic data with planted, known misses so the audit can be graded against ground truth (24 misses of 92 cases). Run the statistical process control and classification methods separately on a real public dataset (UCI SECOM) to see whether they survive real data.

**Alternatives rejected.** Synthetic data only: it cannot show the methods work on messy readings. A public dataset for the audit itself: none has both sources. Anonymized real internal data: not shareable, and nobody else could verify it.

## 2. Control limits are set from a baseline and held fixed

**TODO-DAVID: rewrite in your own words.**

**Context.** My first version of the synthetic charts set the limits from all the data. A gradual drift pulled the centre line toward itself, so the early, healthy points looked abnormal and the drift looked weaker than it was.

**Decision.** Set limits from a baseline window assumed to be healthy (the first 15 subgroups on the synthetic data, the first 300 runs on SECOM) and hold them fixed for everything after. A change then shows up as a signal instead of being absorbed into the limits.

**Alternatives rejected.** Limits from all the data (the drift hides itself). Limits that update continuously (they absorb slow change). EWMA or CUSUM charts: more sensitive to small shifts, but harder to explain than the standard rules, and the aim here was explainability. The cost of the chosen approach showed up on real data: SECOM's baseline was not stable, so later runs signalled constantly, and that is reported as a finding.

## 3. The hand-written rules were frozen before any model was trained

**TODO-DAVID: rewrite in your own words, and say honestly who wrote the rules.**

**Context.** A hand-written rule set is the baseline the learned model is compared against. If the rules can be adjusted after seeing results, the comparison means nothing in either direction.

**Decision.** Write the rules (kind of check first, then the specific type), commit them, and never change them after training. They are scored on the same held-out set as the models, in an English-only version and a multilingual version so the gap is not just about keyword coverage. Note: these rules were drafted with Claude Code, not written from scratch by hand; say so if asked.

**Alternatives rejected.** Tune the rules until they match the model (it would make the baseline look better or worse than it is). Skip the baseline and compare only models (it hides whether learning was needed at all).

## 4. The AI generation layer is three separate calls

**TODO-DAVID: rewrite in your own words.**

**Context.** Turning a messy procedure document into detection SQL can fail in different places: the wrong procedure, the wrong condition, or bad SQL. One call that returns only SQL tells you the numbers are off but not why.

**Decision.** Three calls: resolve which procedure the document describes, extract its condition in terms of the database, then compose the SQL. Each stage's output is validated and recorded. In the recorded run, the queue-deadline document went wrong at the extraction stage (it measured from the end of the window instead of each batch's last event), and that was visible before any SQL existed.

**Alternatives rejected.** A single call (no way to locate a failure). Two calls (it still merges extraction and writing). Asking one call to explain its reasoning: the first stage originally did that, the API intermittently refused it, and it was changed to ask for a quote from the document instead.

## 5. Results are reported even when they are weak

**TODO-DAVID: rewrite in your own words.**

**Context.** On SECOM, the control charts flag almost every run and no classifier clearly beats chance on the later runs. The AI layers also got things wrong in a single recorded run.

**Decision.** Report every number as it came out, with intervals, and state the likely reasons and the limits next to it. Fix the choices (time split, baseline length, look-back window) before looking at results and do not tune on the test period. The weak results are on the site and in the README.

**Alternatives rejected.** Tune until the numbers look better (the result would be meaningless, and it is easy to catch). Drop the real-data check (it is the most honest part of the project). Show only the synthetic results (they are strong because I designed the data).
