# Decisions

These are the main choices I made on OpsAudit. Each one says what the situation was, what I decided, and what I turned down.

## 1. Synthetic data for the audit, and a public real dataset as a stress test

**Context.** I can't copy any data from TSMC, and I couldn't find a public dataset that has both things an audit like this needs, which are the raw events showing that something happened and the automation's own record of what it did. Building the data myself let me plant the kinds of failures that are commonly misunderstood or missed, with the right answers known in advance, so I could show how the audit finds them. The catch is that I'm the one who built the data, so what it shows could be biased by how I built it.

**Decision.** I used synthetic data for the audit itself and ran the control chart and classification methods on a real public dataset, the SECOM data from the University of California, Irvine, to see how they behave on data that I didn't create and couldn't shape.

**Alternatives I turned down.** I could have used synthetic data only, but then nothing would check the methods against reality. Real data only wasn't possible for the audit, and cleaned-up internal data isn't mine to share.

## 2. Control limits come from an early baseline and are then held fixed

**Context.** A control chart needs limits that describe how the process behaves when it is healthy. If the limits are calculated from all of the data, a drift that is present in the data pulls the centre line toward itself and widens the limits, so the drift is partly absorbed and looks weaker than it is.

**Decision.** I set the limits from an early stretch of data that I assume was healthy, the first 15 subgroups in the synthetic data and the first 300 runs in the real data, and I keep them fixed after that, so anything that changes later shows up as a signal instead of being absorbed into the limits.

**Alternatives I turned down.** Calculating the limits from all of the data lets a drift hide itself, and limits that keep updating would absorb slow changes in the same way. The cost of fixed limits showed up on the real data, where all 8 sensors already had signals inside the 300-run baseline, so the limits flag between 3.9% and 48.0% of later runs depending on the sensor, and I report that as it came out.

## 3. The hand-written rules were frozen before any model was trained

**Context.** In practice the rules behind an automation are usually written by engineers who understand the process, while the people running manufacturing mostly work with timing and key performance indicators (KPIs), so the fair comparison for a learned model is a set of rules like the ones an engineer would write down first. If I could change those rules after seeing the results, the comparison wouldn't mean anything either way.

**Decision.** I froze the rules before training and scored them on the same held-out test set as the models, with an English-only version and a multilingual version so that the gap doesn't come only from keyword coverage.

**Alternatives I turned down.** I could have tuned the rules until they matched the model, or compared only models, but the first would make the baseline look better or worse than it is and the second wouldn't show whether learning was needed at all.

## 4. The AI layer that writes detection queries is split into three calls

**Context.** Turning a messy procedure document into a database query can go wrong in three places, which are picking the wrong procedure, misreading its condition, and writing a bad query, and a single request that only returns the query tells me the answer is wrong without telling me where.

**Decision.** I split it into three smaller questions asked in order, which procedure the document is about, what condition it describes, and what query expresses that condition, and I check each answer before moving on. In the run I recorded, the queue-deadline document went wrong at the second step because it measured from the end of the window instead of from each batch's last event, and I could see that before any query existed.

**Alternatives I turned down.** One call returns only the final query, so when it is wrong I cannot tell which of the three jobs failed. Two calls would pair two of the jobs, most naturally understanding the document with writing the query, and then a wrong query could still come from either a misreading of the document or a mistake in the SQL, because the reading is hidden inside the writing. With three calls the middle one returns the condition as plain data, and the third call sees only that data and never the document, so anything the middle call got wrong cannot be corrected by luck later and I can judge that answer on its own. The first step also used to ask the model to explain its reasoning, but the API declined that request in testing, so it now asks for a short quote from the document instead.

## 5. Results are reported as they came out, including the weak ones

**Context.** On the real data the control charts flag almost every run and no classifier clearly beat chance, and the AI layers made mistakes in the run I recorded. I also never expected a large effect, because operations already run acceptably without looking at silent misses, although from the work I did they matter more than they seem to, judging by the time and cost they saved.

**Decision.** I report every number the way it came out, with intervals and with what limits it, because I fixed my choices before looking at results and didn't tune on the test data, and if it works then it works and if it doesn't then I say so.

**Alternatives I turned down.** I could have tuned until the numbers looked better, left out the real-data check, or shown only the synthetic results, which are strong because I designed the data.
