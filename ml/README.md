# ML: what does this procedure check?

A small, honest two-level classification pipeline on synthetic data.

```
pip install -r ml/requirements.txt
python ml/generate_data.py   # writes ml/data/procedures.jsonl (1,650 messy records)
python ml/train.py           # writes ml/results/results.json, which the ML tab displays
```

Given a procedure definition, decide (1) the **kind** of check (interval, state, missing data, absent event, count, countdown) and (2) the **specific thing** it watches (33 of them, such as queue time exceeded, time since PM, OOC alert left open, OOS result with no decision, hold with no owner, repeated autoload failures). The vocabulary is generic semiconductor-style operations language (load ports, carriers, queue time, PM and clean windows, track-out, OOS/OOC, missing fields, state flags), with nothing tied to any company or system.

| File | Role |
|---|---|
| `taxonomy.py` | The two-level taxonomy and the raw material for writing examples (names and descriptions in four languages, field names, condition styles, threshold ranges). Data only. |
| `generate_data.py` | Writes 50 messy labeled records per specific type: inconsistent field names, missing values, mixed units and counts, English/German/Spanish/Japanese text, vague records, descriptions that mention another check only to rule it out, and thresholds with heavy overlap and noise between types (some drawn from an unrelated range). Deterministic (seed 20260801). |
| `features.py` | Maps field names to one schema, then builds explainable features: multilingual keyword concepts in the text, field name, entity and condition, condition-expression patterns, parsed threshold, missing-value flags. Does not import the taxonomy. |
| `rules.py` | The hand-written baseline: branching keyword rules (kind first, then the specific thing), frozen before any model was trained. English-only and multilingual versions. Does not import the taxonomy. |
| `train.py` | One stratified 75/25 split. Tuning by 5-fold cross-validation on the training set only. Test set scored once, for the tree, a random forest, both rule sets and a majority-class floor, at both levels, with a full 33 x 33 confusion matrix. Also reports whether any single feature gives the label away. |

**Latest run** (1,650 records, test set of 413). Accuracy on the specific type / on the kind of check:

| Method | Specific type | Kind |
|---|---|---|
| Decision tree | 79.9% | 86.0% |
| Random forest | 89.1% | 92.3% |
| Hand rules, English keywords | 56.4% | 68.5% |
| Hand rules, multilingual keywords | 66.3% | 73.6% |
| Always guess the most common class | 2.9% | 15.3% |

The tree's 95% interval on the specific type is 75.8% to 83.5%. Its cross-validation accuracy was 77.7% (± 2.5%). See the ML tab for per-class precision and recall, confusion matrices, common mix-ups and disagreement examples.

**No single feature gives the label away.** The most important feature in the tree carries 7.4% of its importance. The best single feature alone scores 11.6% (chance is 3.0%). Removing the threshold features (cross-validated tree 76.9%), the condition features (78.1%) or both (77.4%) barely changes the full-feature 77.7%, so the model is reading the text, field name and entity, not one number.

**Limits.** The data is synthetic and the taxonomy, generator, keyword lists and rules share one author's vocabulary, so real documents would be harder. Vague records (a generic title and description) are hard for every method; the tree does no better than the English rules on them. Many checks have no threshold by design, so that field is often empty. An earlier 30-per-type version was run once during development; this version follows a fixed checklist rather than anything tuned to its test scores, and only this run is reported.

---

# Real-data validation: UCI SECOM (`ml/real/`)

The synthetic work above is only as convincing as the data it is built on, so this part runs the same ideas on **real, public data**.

**Data.** UCI SECOM: 1,567 production runs from a semiconductor process, each with 590 anonymized sensor readings, a pass/fail label and a timestamp (about 89 days, 104 failures = 6.6%). McCann, M. & Johnston, A. (2008). SECOM [Dataset]. UCI Machine Learning Repository. https://doi.org/10.24432/C54305. **CC BY 4.0.** The raw files are about 5 MB of someone else's data, so they are not committed: `download_secom.py` fetches them into `ml/real/data/` (gitignored), caps the size, extracts only the three expected files and checks the shape. The analysis runs with `python -I` (isolated mode) because it reads downloaded files.

```
python ml/real/download_secom.py
python -I ml/real/secom_analysis.py ml/real/data/secom   # writes ml/real/results/secom_results.json
```

| File | Role |
|---|---|
| `download_secom.py` | Safe download of the three files. |
| `real_spc.py` | Individuals-chart SPC for series with missing values: limits from a baseline window then held fixed, Western Electric 1-4 and Nelson 5-6, with a self-test on constructed patterns. |
| `secom_analysis.py` | The whole analysis: SPC, classification, and the bridge to the audit. Every choice is fixed in the file's header before any result is looked at. |

**Choices fixed in advance.** Runs in timestamp order (checked); first 70% train (1,096 runs, 78 failures), last 30% test (471 runs, 26 failures); control limits from the first 300 runs; 8 sensors chosen at evenly spaced positions among those with <5% missing and at least 100 distinct values in the baseline window, with no label used; a failure counts as flagged if a chart signal occurred at that run or in the 5 runs before it (0, 10 and 20 shown as sensitivity); models tuned by 5-fold time-ordered cross-validation inside training, the decision threshold taken from out-of-fold training predictions, and the test period scored once.

**1. SPC.** Individuals charts on 8 sensors. Capability (Cpk, Ppk) is **not reported**: the sensors are anonymized and the dataset publishes no specification limits, so any LSL/USL would be invented. Behaviour only: all 8 sensors already have signals inside the 300-run baseline (7 to 59 each), and 3.9% to 48.0% of later runs signal depending on the sensor. After the baseline, the spread is up to 1.83 times what the limits assume while the mean moves less than 0.9 sigma.

**2. Classification** (test period, 26 failures; no-skill PR-AUC = failure rate = 0.055):

| Method | PR-AUC (95% bootstrap interval) | Precision | Recall | TP / FP / FN |
|---|---|---|---|---|
| Decision tree | 0.060 (0.038-0.111) | 0.125 | 0.038 | 1 / 7 / 25 |
| Random forest | 0.070 (0.040-0.153) | 0.000 | 0.000 | 0 / 2 / 26 |
| Logistic regression | 0.066 (0.043-0.107) | 0.054 | 0.269 | 7 / 122 / 19 |
| Control-chart rule (any of top-5 sensors beyond 3 sigma) | 0.055 (0.034-0.074) | 0.000 | 0.000 | 0 / 5 / 26 |
| Always predict pass | 0.055 | n/a | 0.000 | 0 / 0 / 26 |

No model clearly beats chance on the later runs. Time-ordered cross-validation PR-AUC inside the training period was higher (tree 0.141, forest 0.157, logistic 0.141), and failures were front-loaded (44, 21, 11, 11, 17 per fifth of the timeline), so the early relationship between sensors and failure did not carry forward.

**3. Bridge to the audit.** After the baseline, with a look-back of the failing run plus the 5 runs before it, 57 of 60 failures were flagged and 3 were silent. But 98.8% of passing runs were flagged too (lift 0.96), so a flag says almost nothing about failure. Looking only at the failing run itself, 71.7% of failures against 77.2% of passes were flagged. Per sensor, a signal at the run was equally or less common on failures for 7 of 8 sensors (sensor 23 the exception, 13.3% vs 6.6%, p = 0.06, not significant after allowing for 8 sensors). "Few silent failures" is not a win when almost every run is flagged.

**Limitations.** Anonymized sensors (nothing can be said about what they measure), no specification limits (so no capability), and a small failure count (104 in total, 26 in the test period), so every interval is wide and a different split could rank the models differently. The process was not stable over the 89 days. A plain individuals chart assumes roughly independent, normal readings, which these are not; I did not correct for that. One baseline length, one look-back window and one split were used, none tuned.
