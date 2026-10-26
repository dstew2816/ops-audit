# OpsAudit

[![Continuous integration status](https://github.com/dstew2816/ops-audit/actions/workflows/ci.yml/badge.svg)](https://github.com/dstew2816/ops-audit/actions/workflows/ci.yml)

Automated procedures can fail without anyone noticing, because the platform that runs them has no way to see the cases it never picked up. OpsAudit rebuilds, from raw history, what those procedures should have done, compares that with what they actually did, and then estimates what the gap costs and which fix to make first.

Live demo: https://dstew2816.github.io/ops-audit/

This is a demo of the kind of work I did at TSMC. Everything in it is synthetic data, apart from one check on a public dataset that is described below.

![The OpsAudit home page](docs/overview.jpg)

## The problem

An automated procedure watches for a condition and reacts to it: a conveyor stopped for thirty minutes, stock below its reorder point, a hold that has expired. These procedures run on live events and cannot replay history, so when the platform is down, when an event arrives late, or when a rule is slightly too narrow, the case is simply never picked up and nothing records that it was missed. Success rates are calculated over the cases the automation handled, which means a procedure can report 100% success while missing a quarter of what it was supposed to catch.

Finding those misses takes a second, independent view of what happened. The automation's own log cannot provide it, since the missed cases are exactly the ones that never reached the log.

## Why I built it

I like working with large data sets, and I like the people side of that work: asking the people who run a process what they were trying to achieve and what would help them most, connecting their answers to what the data shows, and then building something that fits. What I enjoy most is learning how a system works from end to end and helping coworkers adopt a new platform or tool along the way. OpsAudit is a small version of that work, built on synthetic data so that it can be shared and so that the right answer is known in advance.

## Approach

**The data and the audit.** I generated the data with seeded code, so every run produces the same 1,997 rows in 13 tables in an in-browser SQLite database. It holds seven automated procedures over a 14-day window, a seven-station route that batches travel through, and one planted six-hour platform outage. Because I planted the misses, I know the right answer and can grade the audit against it. The audit itself is seven hand-written database queries (SQL, or Structured Query Language), one per procedure. Each query rebuilds the cases that should have triggered the procedure and then looks for them in the procedure's own activity log.

**Statistical process control.** Statistical process control (SPC) uses control charts to tell ordinary variation from a real change. I built charts for each station with the process capability index (Cpk) and process performance index (Ppk), the standard run rules that flag patterns such as eight points in a row on one side of the centre line, and a chart of the difference between two parallel stations, which is how drift between machines that should agree shows up. The control limits come from an early baseline and then stay fixed. My first version set them from all the data, and a gradual drift pulled the centre line toward itself and hid the problem.

**The impact model.** Each miss is converted into labor hours and cost at risk, using assumptions that you can edit on the page. Misses that share a cause are grouped into one fix, and the fixes are ranked by cost, by hours or by how quickly the effort pays back.

**The machine learning classifier.** The procedure definitions in a real organization are messy: names in several languages, missing fields, thresholds in mixed units. I generated 1,650 definitions like that and trained a model to say which of 33 kinds of check each one describes, for example queue time exceeded, a hold with no owner, or an alarm that nobody acknowledged. I compared it with hand-written rules that I froze before any training. The split into training and test data was fixed in advance, and the test set was scored once.

**The AI layers.** Two language-model layers sit on top of the audit. The first writes the detection query from a process document, in three separate calls (identify the procedure, extract its condition, write the query), so that when the result is wrong I can see which step went wrong. The second groups the misses by root cause. Both are graded against answers I wrote by hand.

**A stress test on real data.** The synthetic data is only as convincing as the way I built it, so I also ran the SPC and classification methods on a public dataset: the SECOM data from the University of California, Irvine (UCI) Machine Learning Repository, which has 1,567 production runs from a semiconductor process with 590 anonymized sensors and a pass or fail label for each run. I fixed every choice before looking at results, including a split by time so the model is tested on runs it could not have seen.

## What I found

The audit finds that 24 of the 92 cases that qualified were never picked up, which is 26.1%. Under deliberately low assumptions this comes to about 17.6 labor hours and $3,618 at risk over the 14 days, and one fix, a backfill after the outage, covers 8 of the 24 misses and about half of the cost. The dollar figures come from assumptions I chose, which you can change on the page.

The control charts caught a drift that I planted in one station three subgroups after it began, and the chart of the gap between the two parallel stations caught it at subgroup 22. A one-subgroup spike in another station produced exactly one alert. One station has a Cpk of 1.48 but a Ppk of 1.18, which means it is capable while it is stable but did not stay stable.

On 413 held-out procedure definitions the decision tree names the right kind of check 79.9% of the time, against 56.4% to 66.3% for the hand-written rules, depending on whether they know the non-English keywords. A random forest reaches 89.1%. All methods do much worse on deliberately vague definitions, where the tree gets 31.9%. No single feature gives the answer away: the most important one carries 7.4% of the tree's importance, and removing the threshold and condition features changes its cross-validated accuracy by less than a point.

The AI layers had mixed results in the one run I recorded. The first resolved the right procedure for all five documents and matched the hand-written query exactly on two. On the queue-deadline document it returned 36 rows against the correct 4, because the extraction step measured from the end of the window instead of from each batch's last event. That error was visible before any query existed, which is the reason for the three calls. The second layer passed three of its five checks. It recovered the outage cluster exactly, but it also blamed the outage for a hold that has no time component and grouped two missed checks that only looked alike.

The stress test on the real data gave a weak result. After limits were set from the first 300 runs, 95.0% of failing runs were flagged, but so were 98.8% of passing runs, so a flag says almost nothing about whether a run fails. On the later runs no classifier clearly beats chance: the area under the precision-recall curve (PR-AUC) is 0.06 to 0.07, against 0.055 for a model with no skill, and only 26 failures fall in the test period. The sensors were already unstable inside the baseline window, and a plain individuals chart assumes readings that are roughly independent and normally distributed, which these are not. I did not try to correct for that. Cpk and Ppk are not reported for this data, because the sensors are anonymized and no specification limits exist.

## Limitations

The synthetic results come from data I built, with answer keys I wrote, so the vocabulary in the generators, the keyword lists and the rules overlaps and the machine learning accuracy probably overstates what real documents would give. The sample is small: 24 misses, 7 stations, one 14-day window, a 413-record test set, and one recorded run of each AI layer, where a second run could score differently. An earlier machine learning run used 30 records per type, and I replaced it with a fixed checklist (at least 50 per type, noisier thresholds, a check for features that give the label away) instead of tuning to its test scores; only the final run is reported. The first step of the AI generation layer was changed once before the recorded run, because the application programming interface (API) intermittently refused a request to explain its own reasoning, and nothing was changed after I saw scores.

## Run it

```
npm install
npm run dev                          # the site at http://localhost:5173
npm run check                        # every check, no API calls

python -m pip install -r ml/requirements.txt
python ml/generate_data.py           # the machine learning dataset
python ml/train.py                   # trains and scores the classifier
python ml/real/download_secom.py     # fetch the public SECOM data (not committed)
python -I ml/real/secom_analysis.py ml/real/data/secom
```

`npm run check` runs the checks for the data and the 24 planted misses, the SPC math, the impact model, and the two scorers for the AI layers. Each scorer is also tested with deliberately wrong answers, which it must reject. GitHub Actions runs all of this on every push (continuous integration, or CI), along with the build and a fast smoke test of the machine learning pipeline. The live AI runs need an API key in your shell (`npm run gen:check -- --save` and `npm run diag:check -- --save`); the site only displays saved results and the browser never holds a key.

## Where else this applies

An audit like this needs two independent sources anywhere it runs: (a) raw events showing that a condition happened, and (b) the automation's own record of what it did. A silent miss is a gap between the two.

| Domain | The rule | The silent miss | The two sources you'd need |
|---|---|---|---|
| Warehouse inventory | Stock falls below the reorder point, so a purchase order should be created | Stock fell below the point and no purchase order exists | Inventory snapshots + purchase order log |
| Shipping and logistics | A shipment passes its delay threshold, so an exception ticket or customer alert should go out | The shipment was delayed and no ticket or alert exists | Carrier tracking events + ticketing and notification log |
| Quality holds | A hold expires, so the lot should be released or escalated | The hold expired and the lot sat untouched | Hold records + lot movement log |
| Customer service and IT operations | A ticket breaches its service-level target, so it should escalate | It breached and never escalated | Ticket timestamps + escalation log |
| Banking operations | A complaint or dispute passes its response deadline, so it should get a response or escalate | It passed the deadline with no response | Complaint intake records + response log |

Running the audit outside this project means getting both sources and agreeing on the rule's exact definition first; in practice the hard part is access to the automation's own log, not the detection logic. Public datasets rarely include both sources, which is why the audit itself uses synthetic data here, with a separate real-data stress test on the SECOM dataset for the statistical process control and classification methods.

## Data sources and credits

The real-data stress test uses the SECOM dataset: McCann, M. & Johnston, A. (2008). SECOM [Dataset]. UCI Machine Learning Repository. https://doi.org/10.24432/C54305. It is licensed under Creative Commons Attribution 4.0 (CC BY 4.0). The raw files are not committed; `ml/real/download_secom.py` fetches them, and the results file includes the readings of eight charted sensors as derived data, credited to the source. Everything else is synthetic and generated by the code in this repository.

## Built with

JavaScript, React, Vite and SQLite (through sql.js) for the site; Python, pandas and scikit-learn for the machine learning and real-data work; and Claude, through the Anthropic API, for the two AI layers. I chose the problem and the evaluation rules (baselines and rules frozen before training, a time split on real data, no tuning on test sets). Claude Code, an AI coding assistant, wrote most of the code and drafted the answer keys and the hand-written rules. [ARCHITECTURE.md](ARCHITECTURE.md) describes how the modules fit together, and [ml/README.md](ml/README.md) has the detail on the classifier and the real-data analysis.
