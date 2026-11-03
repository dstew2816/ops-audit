# Machine learning: what does this procedure check?

This folder holds a two-level classification pipeline trained on synthetic data. Given the definition of an automated procedure, it decides the kind of check the procedure performs (interval, state, missing data, absent event, count or countdown) and then the specific thing it watches, of which there are 33, such as queue time exceeded, time since preventive maintenance (PM), an out-of-control (OOC) alert left open, an out-of-specification (OOS) result with no decision, a hold with no owner, or repeated autoload failures. The vocabulary is generic semiconductor-style operations language covering load ports, carriers, queue time, PM and clean windows, track-out, missing fields and state flags, and nothing in it is tied to any company or system.

```
pip install -r ml/requirements.txt
python ml/generate_data.py   # writes ml/data/procedures.jsonl (1,650 messy records)
python ml/train.py           # writes ml/results/results.json, which the Monitoring and models view displays
```

## Files

| File | Role |
|---|---|
| `taxonomy.py` | The two-level taxonomy and the raw material for writing examples: names and descriptions in four languages, field names, condition styles and threshold ranges. It contains data only. |
| `generate_data.py` | Writes 50 messy labeled records per specific type, with inconsistent field names, missing values, mixed units and counts, English, German, Spanish and Japanese text, vague records, descriptions that mention another check only to rule it out, and thresholds that overlap heavily between types (some are drawn from an unrelated range). It is deterministic, using seed 20260801. |
| `features.py` | Maps field names onto one schema and builds explainable features: multilingual keyword concepts found in the text, the field name, the entity and condition, condition-expression patterns, the parsed threshold and missing-value flags. It does not import the taxonomy. |
| `rules.py` | The hand-written baseline, a set of branching keyword rules that pick the kind first and then the specific thing. They were frozen before any model was trained and exist in an English-only and a multilingual version. This file does not import the taxonomy either. |
| `train.py` | Makes one stratified 75/25 split, tunes by five-fold cross-validation on the training set only, and scores the test set once for the decision tree, a random forest, both rule sets and a majority-class floor, at both levels, with a full 33 by 33 confusion matrix. It also checks whether any single feature gives the label away. |
| `ci_smoke.py` | A fast version of the pipeline that GitHub Actions runs on every push. |

## Latest run

The data set has 1,650 records and the test set has 413. The table gives accuracy on the specific type and on the kind of check.

| Method | Specific type | Kind |
|---|---|---|
| Decision tree | 79.9% | 86.0% |
| Random forest | 89.1% | 92.3% |
| Hand rules, English keywords | 56.4% | 68.5% |
| Hand rules, multilingual keywords | 66.3% | 73.6% |
| Always guess the most common class | 2.9% | 42.4% |

The tree's 95% interval on the specific type is 75.8% to 83.5%, and its cross-validation accuracy was 77.7% (plus or minus 2.5%). The Monitoring and models view on the site shows per-class precision and recall, the confusion matrices, the most common mix-ups and examples where the methods disagree.

No single feature gives the label away. The most important feature in the tree carries 7.4% of its importance, and the best single feature on its own scores 11.6% where chance is 3.0%. Removing the threshold features (cross-validated tree accuracy 76.9%), the condition features (78.1%) or both (77.4%) changes little from the full-feature 77.7%, so the model is reading the text, the field name and the entity and not one number.

The data is synthetic, and the taxonomy, the generator, the keyword lists and the rules all share one author's vocabulary, so real documents would be harder. Vague records, which have a generic title and description, are hard for every method, and the tree does no better than the English rules on them. Many checks have no threshold by design, so that field is often empty. An earlier version with 30 records per type was run once during development, and this version follows a fixed checklist instead of anything tuned to its test scores, so only this run is reported.

---

# Real-data stress test: UCI SECOM (`ml/real/`)

The synthetic work above is only as convincing as the data it is built on, so this part runs the same ideas on real, public data.

## Data

The data is the SECOM data set from the University of California, Irvine (UCI) Machine Learning Repository, which holds 1,567 production runs from a semiconductor process. Each run has 590 anonymized sensor readings, a pass or fail label and a timestamp, and the runs cover about 89 days with 104 failures (6.6%). The citation is McCann, M. & Johnston, A. (2008). SECOM [Dataset]. UCI Machine Learning Repository, https://doi.org/10.24432/C54305, licensed under Creative Commons Attribution 4.0 (CC BY 4.0). The raw files are about 5 MB of someone else's data, so they are not committed. `download_secom.py` fetches them into `ml/real/data/`, which is gitignored, caps the size, extracts only the three expected files and checks their shape. The analysis runs with `python -I` (isolated mode) because it reads downloaded files.

```
python ml/real/download_secom.py
python -I ml/real/secom_analysis.py ml/real/data/secom   # writes ml/real/results/secom_results.json
```

| File | Role |
|---|---|
| `download_secom.py` | Downloads the three files safely. |
| `real_spc.py` | Individuals-chart statistical process control (SPC) for series with missing values. Limits come from a baseline window and are then held fixed, the Western Electric rules 1 to 4 and Nelson rules 5 and 6 are applied, and a self-test runs on constructed patterns. |
| `secom_analysis.py` | The whole analysis: SPC, classification and the bridge to the audit. Every choice is fixed in the file's header before any result is looked at. |

## Choices fixed in advance

The runs are in timestamp order, which the script checks. The first 70% form the training period (1,096 runs, 78 failures) and the last 30% form the test period (471 runs, 26 failures). The control limits come from the first 300 runs. Eight sensors were chosen at evenly spaced positions among those with under 5% missing values and at least 100 distinct values in the baseline window, without using the label. A failure counts as flagged if a chart signal occurred at that run or in the 5 runs before it, and look-backs of 0, 10 and 20 runs are shown as a sensitivity check. The models are tuned by five-fold time-ordered cross-validation inside the training period, the decision threshold is taken from out-of-fold training predictions, and the test period is scored once.

## 1. Statistical process control

The individuals charts cover the 8 sensors. Capability indices (Cpk and Ppk) are not reported, because the sensors are anonymized and the data set publishes no specification limits, so any lower or upper specification limit would have to be invented. The charts therefore describe behavior only. All 8 sensors already have signals inside the 300-run baseline (between 7 and 59 each), and between 3.9% and 48.0% of later runs signal, depending on the sensor. After the baseline, the spread is up to 1.83 times what the limits assume while the mean moves by less than 0.9 standard deviations.

## 2. Classification

The test period has 26 failures, so the precision-recall area under the curve (PR-AUC) for a model with no skill equals the failure rate, 0.055.

| Method | PR-AUC (95% bootstrap interval) | Precision | Recall | True positives / false positives / false negatives |
|---|---|---|---|---|
| Decision tree | 0.060 (0.038-0.111) | 0.125 | 0.038 | 1 / 7 / 25 |
| Random forest | 0.070 (0.040-0.153) | 0.000 | 0.000 | 0 / 2 / 26 |
| Logistic regression | 0.066 (0.043-0.107) | 0.054 | 0.269 | 7 / 122 / 19 |
| Control-chart rule (any of the top 5 sensors beyond 3 sigma) | 0.055 (0.034-0.074) | 0.000 | 0.000 | 0 / 5 / 26 |
| Always predict pass | 0.055 | not defined | 0.000 | 0 / 0 / 26 |

No model clearly beats chance on the later runs. Time-ordered cross-validation PR-AUC inside the training period was higher (tree 0.141, forest 0.157, logistic regression 0.141), and failures were concentrated early in the timeline, at 44, 21, 11, 11 and 17 per fifth, so the early relationship between sensors and failure did not carry forward.

## 3. Bridge to the audit

After the baseline, with a look-back of the failing run plus the 5 runs before it, 57 of 60 failures were flagged and 3 were silent. However, 98.8% of passing runs were flagged as well (lift 0.96), so a flag says almost nothing about whether a run will fail. Looking only at the failing run itself, 71.7% of failures and 77.2% of passes were flagged. For 7 of the 8 sensors, a signal at the run was equally common or less common on failures than on passes, and the exception was sensor 23 (13.3% against 6.6%, p = 0.06), which is not significant once the 8 sensors are allowed for. Having few silent failures is not a good result when almost every run is flagged.

## Limitations

The sensors are anonymized, so nothing can be said about what they measure, and there are no specification limits, so there is no capability analysis. The failure count is small, with 104 in total and 26 in the test period, so every interval is wide and a different split could rank the models differently. The process was not stable over the 89 days, and a plain individuals chart assumes roughly independent, normally distributed readings, which these are not. I did not correct for that. I used one baseline length, one look-back window and one split, and none of them was tuned.
