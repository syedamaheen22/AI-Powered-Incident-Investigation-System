# Long Context Strategy Report

- Model: llama3
- Scenario size: 16413 words (~32.8 pages at 500 words/page)
- Naive context limit: first 12000 characters
- Summarization chunks: size 4500, overlap 350
- Summary context length: 703 characters

## Results by Question Type

| Question ID | Type | Naive Score | Summarize-Then-Answer Score | Winner | What Broke / Why |
|---|---|---:|---:|---|---|
| q1 | factual-early | 1 | 1 | tie | Both strategies had enough evidence for this question type. |
| q2 | factual-mid | 0 | 1 | summarize-then-answer | Failure likely due to information compression, phrasing drift, or missing exact entity strings. |
| q3 | factual-late | 0 | 1 | summarize-then-answer | Naive truncation dropped late-document facts; summary strategy retained them through chunk coverage. |
| q4 | numeric-late | 0 | 1 | summarize-then-answer | Naive truncation dropped late-document facts; summary strategy retained them through chunk coverage. |
| q5 | synthesis | 0 | 1 | summarize-then-answer | Failure likely due to information compression, phrasing drift, or missing exact entity strings. |

## Short Conclusion

- Average score (naive): 0.2
- Average score (summarize then answer): 1
- In this experiment, summarize-then-answer generally wins on late-fact and long-range synthesis questions.
- Naive stuffing can still do well on early facts that survive truncation.

## What Else Can Improve These Strategies

1. Retrieval-Augmented Generation (RAG): retrieve only top relevant chunks for each question instead of fixed truncation.
2. Hierarchical summarization with citations: keep source chunk IDs to verify answers and reduce summary hallucinations.
3. Hybrid routing: start with retrieval; if confidence is low, fallback to deeper multi-hop chunk reasoning.
4. Structured fact tables: extract entities/numbers/dates into JSON before QA to preserve exact details.
5. Adaptive context budgets: allocate more context to numeric or late-section questions likely to fail on truncation.

## Answer Snapshots

### q1 (factual-early)
Question: What is the project codename?
- Naive: Canonical fact: project codename is ORBIT-LANTERN.
- Summary: ORBIT-LANTERN

### q2 (factual-mid)
Question: Name the three pilot cities.
- Naive: Not found in provided context.
- Summary: Lahore, Berlin, and Nairobi.

### q3 (factual-late)
Question: Who is the emergency fallback vendor?
- Naive: Not found in provided context.
- Summary: Northwind Grid Services.

### q4 (numeric-late)
Question: What final budget was approved, and what contingency amount was set?
- Naive: Not found in provided context.
- Summary: According to the provided context, the final budget was $4.8 million, and the contingency reserve was $600k.

### q5 (synthesis)
Question: What is the main risk and the main mitigation strategy described across the scenario?
- Naive: Not found in provided context.
- Summary: Main risk: supply chain delays Main mitigation: regional buffer warehouses

## Raw Sizes

- Full long scenario chars: 123643
- Naive context chars used: 12000

## End Result: Better Method and Why

- Better method: summarize-then-answer.
- Why: it won most question types, especially mid/late factual and synthesis questions, because it preserved useful signals from across the full document instead of losing them to naive truncation.