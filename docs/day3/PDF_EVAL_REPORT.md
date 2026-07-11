# PDF Evaluation Report: LLM-A vs LLM-B

- Run date: 2026-03-16T07:50:50.855Z
- LLM-A: llama3
- LLM-B: gemma3:4b
- Temperature: 0 (deterministic)
- Total questions: 25 (20 answerable + 5 unanswerable)
- Source PDFs: JPMorgan Chase 2024 Annual Report (372 pages), Johnson & Johnson 2024 Annual Report (140 pages)

## Section 1 — Results Table: LLM-A vs LLM-B on 4 Metrics

| Metric | LLM-A | LLM-B | Winner |
|---|---:|---:|---|
| Keyword Recall (avg) | 0.42 | 0.475 | LLM-B (gemma3:4b) |
| Refusal Accuracy (avg) | 1 | 1 | Tie |
| Answer Length OK (avg) | 1 | 0.84 | LLM-A (llama3) |
| No-Hallucination Rate (avg) | 1 | 1 | Tie |
| **Composite Score (avg)** | **0.895** | **0.869** | **LLM-A (llama3)** |
| Avg Latency (ms) | 5652 | 6070 | LLM-A (llama3) |

### Per-Question Comparison

| Q | Type | Difficulty | LLM-A Score | LLM-A Pass | LLM-B Score | LLM-B Pass |
|---|---|---|---:|:---:|---:|:---:|
| q01 | factual | easy | 0.75 | ✓ | 0.75 | ✓ |
| q02 | factual | easy | 0.833 | ✓ | 0.833 | ✓ |
| q03 | factual | easy | 0.75 | ✓ | 1 | ✓ |
| q04 | factual | easy | 0.75 | ✓ | 0.875 | ✓ |
| q05 | factual | medium | 0.75 | ✓ | 0.75 | ✓ |
| q06 | factual | medium | 0.75 | ✓ | 0.75 | ✓ |
| q07 | factual | medium | 1 | ✓ | 0.75 | ✓ |
| q08 | factual | medium | 1 | ✓ | 0.5 | ✓ |
| q09 | factual | medium | 0.875 | ✓ | 0.875 | ✓ |
| q10 | factual | medium | 0.75 | ✓ | 1 | ✓ |
| q11 | factual | easy | 0.75 | ✓ | 0.75 | ✓ |
| q12 | factual | easy | 1 | ✓ | 0.75 | ✓ |
| q13 | factual | easy | 0.917 | ✓ | 0.583 | ✓ |
| q14 | factual | medium | 0.75 | ✓ | 0.75 | ✓ |
| q15 | factual | medium | 1 | ✓ | 1 | ✓ |
| q16 | factual | medium | 1 | ✓ | 1 | ✓ |
| q17 | factual | medium | 1 | ✓ | 1 | ✓ |
| q18 | factual | hard | 1 | ✓ | 1 | ✓ |
| q19 | synthesis | medium | 0.75 | ✓ | 0.8 | ✓ |
| q20 | synthesis | hard | 1 | ✓ | 1 | ✓ |
| q21 | unanswerable | trap | 1 | ✓ | 1 | ✓ |
| q22 | unanswerable | trap | 1 | ✓ | 1 | ✓ |
| q23 | unanswerable | trap | 1 | ✓ | 1 | ✓ |
| q24 | unanswerable | trap | 1 | ✓ | 1 | ✓ |
| q25 | unanswerable | trap | 1 | ✓ | 1 | ✓ |

## Section 2 — Pass/Fail Summary

| Model | Passed | Failed | Pass Rate |
|---|---:|---:|---:|
| LLM-A (llama3) | 25 | 0 | 100% |
| LLM-B (gemma3:4b) | 25 | 0 | 100% |

### LLM-A Per-Category Pass Rate

| Type | Passed | Total | Pass Rate |
|---|---:|---:|---:|
| factual | 18 | 18 | 100% |
| synthesis | 2 | 2 | 100% |
| unanswerable | 5 | 5 | 100% |

### LLM-B Per-Category Pass Rate

| Type | Passed | Total | Pass Rate |
|---|---:|---:|---:|
| factual | 18 | 18 | 100% |
| synthesis | 2 | 2 | 100% |
| unanswerable | 5 | 5 | 100% |

## Section 3 — Top 5 Failure Examples

Failures are ranked by lowest composite score across both models.

| # | Q | Model | Composite | 1-line Reason |
|---|---|---|---:|---|
| 1 | q08 | gemma3:4b | 0.5 | Low keyword recall and format-length mismatch on a numeric factual answer. |
| 2 | q13 | gemma3:4b | 0.583 | Partial extraction on dividend-streak question and overlong response format. |
| 3 | q01 | llama3 | 0.75 | Refused despite answer being present in source, causing zero keyword recall. |
| 4 | q03 | llama3 | 0.75 | Returned "not found" for a present market-data value. |
| 5 | q04 | llama3 | 0.75 | Returned "not found" for a present employee-count value. |

### Failure Details

#### Failure 1: q08 (gemma3:4b)
- Question: What was JPMorgan Chase's Return on Tangible Common Equity (ROTCE) in 2024?
- Reason: low keyword recall (0); answer empty or too long

#### Failure 2: q13 (gemma3:4b)
- Question: For how many consecutive years had Johnson & Johnson increased its dividend as of 2024?
- Reason: low keyword recall (0.333); answer empty or too long

#### Failure 3: q01 (llama3)
- Question: What was JPMorgan Chase's total net revenue for fiscal year 2024?
- Reason: low keyword recall (0)

#### Failure 4: q03 (llama3)
- Question: What was JPMorgan Chase's closing share price at end of 2024?
- Reason: low keyword recall (0)

#### Failure 5: q04 (llama3)
- Question: How many employees did JPMorgan Chase have at year-end 2024?
- Reason: low keyword recall (0)

## Section 4 — Test Set (25 Questions with Ground Truth)

| # | Source | Type | Question | Ground Truth |
|---:|---|---|---|---|
| q01 | JPM | factual | What was JPMorgan Chase's total net revenue for fiscal year 2024? | $177,556 million (approximately $177.6 billion) |
| q02 | JPM | factual | What was JPMorgan Chase's net income in 2024? | $58,471 million (approximately $58.5 billion) |
| q03 | JPM | factual | What was JPMorgan Chase's closing share price at end of 2024? | $239.71 |
| q04 | JPM | factual | How many employees did JPMorgan Chase have at year-end 2024? | 317,233 employees |
| q05 | JPM | factual | What was JPMorgan Chase's Common Equity Tier 1 (CET1) capital ratio at end of 2024? | 15.7% |
| q06 | JPM | factual | What were JPMorgan Chase's total assets at the end of fiscal year 2024? | $4,002,814 million (approximately $4.0 trillion) |
| q07 | JPM | factual | What cash dividend per share did JPMorgan Chase declare in 2024? | $4.80 per share |
| q08 | JPM | factual | What was JPMorgan Chase's Return on Tangible Common Equity (ROTCE) in 2024? | 22% |
| q09 | JPM | factual | What was JPMorgan Chase's provision for credit losses in 2024? | $10,678 million |
| q10 | JPM | factual | What was JPMorgan Chase's book value per share at end of 2024? | $116.07 |
| q11 | JNJ | factual | What were Johnson & Johnson's Innovative Medicine segment sales in fiscal year 2024? | $57.0 billion |
| q12 | JNJ | factual | What was Johnson & Johnson's adjusted diluted net earnings per share in 2024? | $9.98 |
| q13 | JNJ | factual | For how many consecutive years had Johnson & Johnson increased its dividend as of 2024? | 62 consecutive years |
| q14 | JNJ | factual | What was Johnson & Johnson's total debt balance at the end of fiscal year 2024? | $36.6 billion |
| q15 | JNJ | factual | What was Johnson & Johnson's approximate free cash flow in 2024? | Approximately $20 billion |
| q16 | JNJ | factual | What MedTech product did Johnson & Johnson receive FDA clearance for partial-knee and robot-assisted spine surgery in 2024? | VELYS robotic system |
| q17 | JNJ | factual | What planned acquisition did Johnson & Johnson announce in 2024 that is referenced in the annual report? | Intra-Cellular Therapies |
| q18 | JNJ | factual | What was Johnson & Johnson's full-year adjusted net earnings in 2024? | $24.2 billion |
| q19 | JPM | synthesis | What are JPMorgan Chase's two primary branded services mentioned in the annual report, and which customer segments do they each serve? | J.P. Morgan (institutional and corporate clients globally) and Chase (consumers and small businesses, predominantly in the U.S.) |
| q20 | JNJ | synthesis | How many major products did Johnson & Johnson launch in its MedTech segment in 2024, and name at least two specific platforms mentioned? | 15 major products launched in MedTech in 2024. Platforms include VARIPULSE (pulsed field ablation) and VELYS (robot-assisted spine and partial-knee surgery). |
| q21 | NONE | unanswerable | What was the exact salary of JPMorgan Chase's CEO Jamie Dimon in 2024? | NOT IN SOURCE — The exact CEO salary figure does not appear in the 2024 Annual Report Financial Highlights or narrative sections provided. |
| q22 | NONE | unanswerable | What was Johnson & Johnson's quarterly revenue breakdown for Q3 2024? | NOT IN SOURCE — Quarterly breakdowns are not provided within the annual report text included in the evaluation corpus. |
| q23 | NONE | unanswerable | How many hospital systems did JPMorgan Chase partner with in its healthcare lending division in 2024? | NOT IN SOURCE — This specific metric does not appear in the JPMorgan Chase 2024 Annual Report. |
| q24 | NONE | unanswerable | What is Johnson & Johnson's projected revenue target for fiscal year 2027? | NOT IN SOURCE — Future revenue projections for 2027 are not stated in the 2024 Annual Report. |
| q25 | NONE | unanswerable | How many data centers does JPMorgan Chase operate globally as of 2024? | NOT IN SOURCE — The number of data centers is not disclosed in the 2024 Annual Report provided. |

## End Result: Better Method and Why

- Better method: LLM-A (llama3).
- Why: it achieved the stronger composite score and lower latency, with better answer-length control while maintaining the same refusal and no-hallucination reliability as LLM-B.
