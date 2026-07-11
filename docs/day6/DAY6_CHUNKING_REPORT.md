# Day 6 Chunking Strategy Comparison

- Run date: 2026-03-25T06:17:57.752Z
- Embedding model: nomic-embed-text
- Top-k: 5
- Corpus: JPM + JNJ full-text files

## Comparison table

| Strategy | hit-rate@5 (answerable) | hit-rate@5 % (answerable) | hit-rate@5 (all questions) | hit-rate@5 % (all questions) |
|---|---:|---:|---:|---:|
| fixed_size | 14/20 | 70.0% | 15/25 | 60.0% |
| overlapping | 14/20 | 70.0% | 16/25 | 64.0% |
| recursive | 9/20 | 45.0% | 9/25 | 36.0% |

## Analysis

### 5 cases where advanced chunking improved retrieval
- q06: What were JPMorgan Chase's total assets at the end of fiscal year 2024?

### 3 cases where advanced chunking performed worse
- q01: What was JPMorgan Chase's total net revenue for fiscal year 2024?
- q02: What was JPMorgan Chase's net income in 2024?
- q03: What was JPMorgan Chase's closing share price at end of 2024?

## Notes

- Advanced strategy used: recursive chunking (paragraph -> sentence -> word fallback).
- Improved means recursive hit and both fixed/overlap miss for the same question.
- Worse means recursive miss while fixed or overlap hits for the same question.

## End Result: Better Method and Why

- Better method: overlapping chunking.
- Why: it matched the best answerable hit-rate and delivered the highest overall hit-rate across all questions, giving stronger recall without the drop seen in recursive chunking.