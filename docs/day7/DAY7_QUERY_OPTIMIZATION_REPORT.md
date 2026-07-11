# Day 7 Query Optimization + Metadata Filtering Comparison

- Run date: 2026-03-26T06:23:32.893Z
- LLM model: llama3
- Embedding model: nomic-embed-text
- Retrieval top-k: 5
- Query optimization: HyDE + multi-query rewriting
- Metadata attached to chunks: source, section, page, date
- Metadata filters used in optimized retrieval: source, section

## Comparison table

| Metric | Baseline retrieval | Optimized retrieval |
|---|---:|---:|
| hit-rate@5 (all questions) | 12/25 (48.0%) | 10/25 (40.0%) |
| hit-rate@5 (answerable only) | 11/20 (55.0%) | 10/20 (50.0%) |

## Examples where query optimization improved results

- q02 (JPM, section_hint=financial_highlights): What was JPMorgan Chase's net income in 2024?
  - baseline: JPM-p3-c1, JPM-p8-c3, JPM-p108-c1, JPM-p123-c1, JPM-p1-c1
  - optimized: JPM-p88-c5, JPM-p2-c3, JPM-p106-c3, JPM-p88-c4, JPM-p365-c1
- q08 (JPM, section_hint=financial_highlights): What was JPMorgan Chase's Return on Tangible Common Equity (ROTCE) in 2024?
  - baseline: JPM-p1-c1, JPM-p178-c5, JPM-p178-c6, JPM-p3-c1, JPM-p262-c4
  - optimized: JPM-p2-c3, JPM-p107-c4, JPM-p106-c3, JPM-p88-c4, JPM-p84-c4
- q10 (JPM, section_hint=financial_highlights): What was JPMorgan Chase's book value per share at end of 2024?
  - baseline: JPM-p2-c3, JPM-p234-c3, JPM-p234-c4, JPM-p106-c3, JPM-p178-c6
  - optimized: JPM-p2-c3, JPM-p106-c3, JPM-p84-c4, JPM-p365-c1, JPM-p2-c1

## 5 failure cases where optimization did not help

- q01 (JPM, section_hint=financial_highlights, baseline_hit=false, optimized_hit=false): What was JPMorgan Chase's total net revenue for fiscal year 2024?
  - baseline: JPM-p106-c3, JPM-p117-c1, JPM-p121-c1, JPM-p106-c2, JPM-p3-c1
  - optimized: JPM-p106-c3, JPM-p2-c3, JPM-p106-c2, JPM-p117-c1, JPM-p121-c1
- q03 (JPM, section_hint=financial_highlights, baseline_hit=false, optimized_hit=false): What was JPMorgan Chase's closing share price at end of 2024?
  - baseline: JPM-p234-c3, JPM-p234-c4, JPM-p84-c4, JPM-p178-c6, JPM-p2-c3
  - optimized: JPM-p2-c3, JPM-p84-c4, JPM-p106-c3, JPM-p89-c4, JPM-p88-c3
- q04 (JPM, section_hint=financial_highlights, baseline_hit=false, optimized_hit=false): How many employees did JPMorgan Chase have at year-end 2024?
  - baseline: JPM-p262-c4, JPM-p1-c1, JPM-p70-c1, JPM-p110-c1, JPM-p106-c3
  - optimized: JPM-p106-c3, JPM-p2-c3, JPM-p106-c2, JPM-p2-c1, JPM-p365-c1
- q07 (JPM, section_hint=financial_highlights, baseline_hit=false, optimized_hit=false): What cash dividend per share did JPMorgan Chase declare in 2024?
  - baseline: JPM-p139-c1, JPM-p234-c3, JPM-p234-c4, JPM-p268-c4, JPM-p325-c1
  - optimized: JPM-p2-c3, JPM-p106-c3, JPM-p84-c4, JPM-p88-c3, JPM-p350-c4
- q12 (JNJ, section_hint=financial_highlights, baseline_hit=false, optimized_hit=false): What was Johnson & Johnson's adjusted diluted net earnings per share in 2024?
  - baseline: JNJ-p91-c1, JNJ-p91-c2, JNJ-p67-c6, JNJ-p48-c6, JNJ-p35-c1
  - optimized: JNJ-p67-c6, JNJ-p35-c1, JNJ-p91-c1, JNJ-p91-c2, JNJ-p15-c3

## Notes

- Baseline retrieval: single-question embedding query.
- Optimized retrieval: HyDE passage + multi-query rewrites + reciprocal-rank fusion.
- Optimized pipeline applies metadata filtering by source and source+section (when a section hint is inferred from question metadata).

## End Result: Better Method and Why

- Better method: baseline retrieval.
- Why: it achieved higher hit-rate than the optimized pipeline in this run; the added rewrites and filtering likely over-constrained retrieval and reduced recall for several questions.