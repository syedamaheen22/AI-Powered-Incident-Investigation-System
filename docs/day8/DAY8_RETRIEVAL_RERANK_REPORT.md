# Day 8 Retrieval Strategy + Reranking Comparison

- Run date: 2026-03-27T07:50:29.437Z
- LLM model: llama3
- Embedding model: nomic-embed-text
- Retrieval top-k: 5
- Rerank pool size: 15

## Comparison tables

### hit-rate@5 (vector vs hybrid retrieval)

| Setup | Vector-only | Hybrid |
|---|---:|---:|
| Without reranking | 48.0% | 72.0% |
| With reranking | 52.0% | 56.0% |

### answer correctness before vs after reranking

| Strategy | Before reranking | After reranking |
|---|---:|---:|
| Vector-only | 48.0% | 48.0% |
| Hybrid | 44.0% | 44.0% |

### citation accuracy before vs after reranking

| Strategy | Before reranking | After reranking |
|---|---:|---:|
| Vector-only | 48.0% | 60.0% |
| Hybrid | 48.0% | 56.0% |

## Analysis

### 5 examples where hybrid retrieval improved results

- q01: What was JPMorgan Chase's total net revenue for fiscal year 2024?
  - vector ids: JPM-p106-c3, JPM-p117-c1, JPM-p121-c1, JPM-p106-c2, JPM-p3-c1
  - hybrid ids: JPM-p106-c3, JPM-p121-c1, JPM-p2-c3, JPM-p88-c4, JPM-p88-c5
- q02: What was JPMorgan Chase's net income in 2024?
  - vector ids: JPM-p3-c1, JPM-p8-c3, JPM-p108-c1, JPM-p123-c1, JPM-p1-c1
  - hybrid ids: JPM-p88-c4, JPM-p88-c3, JPM-p3-c1, JPM-p5-c2, JPM-p8-c3
- q07: What cash dividend per share did JPMorgan Chase declare in 2024?
  - vector ids: JPM-p139-c1, JPM-p234-c3, JPM-p234-c4, JPM-p268-c4, JPM-p325-c1
  - hybrid ids: JPM-p325-c1, JPM-p139-c1, JPM-p2-c1, JPM-p325-c7, JPM-p234-c3
- q08: What was JPMorgan Chase's Return on Tangible Common Equity (ROTCE) in 2024?
  - vector ids: JPM-p1-c1, JPM-p178-c5, JPM-p178-c6, JPM-p3-c1, JPM-p262-c4
  - hybrid ids: JPM-p1-c1, JPM-p5-c2, JPM-p178-c5, JPM-p13-c1, JPM-p178-c6
- q10: What was JPMorgan Chase's book value per share at end of 2024?
  - vector ids: JPM-p2-c3, JPM-p234-c3, JPM-p234-c4, JPM-p106-c3, JPM-p178-c6
  - hybrid ids: JPM-p88-c1, JPM-p5-c2, JPM-p2-c1, JPM-p2-c3, JPM-p234-c3

### 5 examples where reranking changed the final answer

- q01 (vector_only)
  - Q: What was JPMorgan Chase's total net revenue for fiscal year 2024?
  - before: Insufficient context. The provided context does not mention JPMorgan Chase's total net revenue for fiscal year 2024. It only provides information on international metrics and loans retained as of or for the years ended December 31, 2024 and 2023.
  - after: Insufficient context. The provided context does not mention JPMorgan Chase's total net revenue for fiscal year 2024. It only mentions net income and revenue figures for different years or periods, but not specifically for FY 2024.
  - correctness: false -> false
- q01 (hybrid)
  - Q: What was JPMorgan Chase's total net revenue for fiscal year 2024?
  - before: Insufficient context. The provided context does not mention JPMorgan Chase's total net revenue for fiscal year 2024. It only provides information about international metrics and non-GAAP financial measures, but does not provide the total net revenue figure for the entire company.
  - after: Insufficient context. The provided context does not mention JPMorgan Chase's total net revenue for fiscal year 2024. It only provides information on the firm's net interest income and noninterest revenue, as well as international metrics for different regions.
  - correctness: false -> false
- q02 (vector_only)
  - Q: What was JPMorgan Chase's net income in 2024?
  - before: Insufficient context. The provided context does not mention JPMorgan Chase's net income in 2024 specifically. It only mentions net income for certain years (2020, 2021, and 2023) but not 2024.
  - after: Insufficient context. The provided context does not mention JPMorgan Chase's net income for 2024, only comparing it to 2023.
  - correctness: false -> false
- q02 (hybrid)
  - Q: What was JPMorgan Chase's net income in 2024?
  - before: Insufficient context. The provided context does not mention JPMorgan Chase's net income for 2024, only providing information about its performance and rankings in various areas.
  - after: Insufficient context. The provided context only mentions JPMorgan Chase's net income in 2024 being $17.6 billion [JPM-p108-c1] and $10.6 billion [JPM-p123-c1], but it does not specify which one is the correct answer for 2024.
  - correctness: false -> false
- q03 (vector_only)
  - Q: What was JPMorgan Chase's closing share price at end of 2024?
  - before: Insufficient context. The provided context does not mention JPMorgan Chase's closing share price at the end of 2024.
  - after: Insufficient context. The provided context does not contain information about JPMorgan Chase's closing share price at end of 2024.
  - correctness: false -> false

## Notes

- Vector-only retrieval: embedding similarity against Chroma.
- Hybrid retrieval: reciprocal rank fusion of vector and lexical retrieval.
- Reranking: LLM relevance scoring on retrieved candidates before final top-k selection.

## End Result: Better Method and Why

- Better method: hybrid retrieval without reranking for retrieval quality.
- Why: it produced the highest hit-rate@5 in this experiment; reranking improved some citation metrics but reduced top retrieval recall and did not improve final answer correctness.