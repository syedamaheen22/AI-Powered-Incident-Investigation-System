# RAG vs Full-Text LLM Evaluation (Basic Setup)

- Date: 2026-03-18T08:34:54.939Z
- LLM (open-source): llama3
- Embeddings: nomic-embed-text
- Vector DB: Chroma
- Retrieval top-k: 4
- Chunking: fixed 180 words, overlap 0 (simple word chunking)

## Results Comparison

| Mode | Correct / Total | Correctness Rate | Citation Present |
|---|---:|---:|---:|
| Full-text LLM (no retrieval) | 2/25 | 8.0% | 0/25 |
| Basic RAG (Chroma retrieval) | 14/25 | 56.0% | 16/25 |

## Failure Cases

| Mode | Missed Info | Hallucination | Truncation |
|---|---:|---:|---:|
| Full-text LLM (no retrieval) | 23 | 2 | 0 |
| Basic RAG (Chroma retrieval) | 11 | 1 | 0 |

### Incorrect Answers: Full-text LLM

| QID | Type | Failure Labels |
|---|---|---|
| q01 | factual | missed_info |
| q02 | factual | missed_info |
| q03 | factual | missed_info |
| q04 | factual | missed_info, hallucination |
| q05 | factual | missed_info |
| q06 | factual | missed_info |
| q07 | factual | missed_info |
| q08 | factual | missed_info |
| q09 | factual | missed_info |
| q10 | factual | missed_info |
| q11 | factual | missed_info |
| q12 | factual | missed_info, hallucination |
| q13 | factual | missed_info |
| q14 | factual | missed_info |
| q15 | factual | missed_info |
| q16 | factual | missed_info |
| q17 | factual | missed_info |
| q18 | factual | missed_info |
| q20 | synthesis | missed_info |
| q21 | unanswerable | missed_info |
| q22 | unanswerable | missed_info |
| q23 | unanswerable | missed_info |
| q25 | unanswerable | missed_info |

### Incorrect Answers: Basic RAG

| QID | Type | Failure Labels |
|---|---|---|
| q01 | factual | missed_info |
| q02 | factual | missed_info, hallucination |
| q04 | factual | missed_info |
| q05 | factual | missed_info |
| q06 | factual | missed_info |
| q07 | factual | missed_info |
| q08 | factual | missed_info |
| q09 | factual | missed_info |
| q15 | factual | missed_info |
| q18 | factual | missed_info |
| q20 | synthesis | missed_info |

## Short Conclusion

- Where basic RAG helped: q03, q10, q11, q12, q13, q14, q16, q17, q21, q22, q23, q25
- Where basic RAG did not help: none
- Basic RAG helped mostly when full-text prompting lost key details in long documents; retrieval focused the model on relevant local context.
- Basic RAG did not help when retrieval returned incomplete or mixed chunks, leading to missed values or confident but wrong numeric answers.

## End Result: Better Method and Why

- Better method: basic RAG with Chroma retrieval.
- Why: it substantially outperformed full-text prompting on correctness and citation presence by narrowing context to relevant evidence instead of overwhelming the model with entire documents.