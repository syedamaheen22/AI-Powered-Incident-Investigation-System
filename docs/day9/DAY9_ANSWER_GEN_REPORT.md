# Day 9 Answer Generation: Freeform vs. Citation-Enforced Prompts

- Run date: 2026-03-30T06:08:04.881Z
- LLM model: llama3
- Embedding model: nomic-embed-text
- Retrieval top-k: 5

## Comparison tables

### Answer correctness & citation presence

| Metric | Freeform | Citation-Enforced |
|---|---:|---:|
| Answer correctness | 36.0% | 48.0% |
| Citation presence | 8.0% | 48.0% |
| JSON validity | 100.0% | 100.0% |
| Avg confidence | 0.000 | 0.436 |

## Analysis

### 5 hallucination examples and root causes

- q01 (freeform)
  - Q: What was JPMorgan Chase's total net revenue for fiscal year 2024?
  - Ground truth: $177,556 million (approximately $177.6 billion)
  - Generated: Insufficient context. The provided context does not contain the total net revenue for fiscal year 2024 of JPMorgan Chase. It only provides information on the company's financial performance and metrics for different regions and business segments, but it does not provide a comprehensive overview of the company's total net revenue for the entire year.
  - Hallucination: Insufficient context. The provided context does not contain the total net revenue for fiscal year 20
  - Why: Answer contains unsupported content not found in context and does not match expected keywords

- q01 (citation_enforced)
  - Q: What was JPMorgan Chase's total net revenue for fiscal year 2024?
  - Ground truth: $177,556 million (approximately $177.6 billion)
  - Generated: Insufficient context.
  - Hallucination: Insufficient context.
  - Why: Answer contains unsupported content not found in context despite JSON format requirement

- q02 (freeform)
  - Q: What was JPMorgan Chase's net income in 2024?
  - Ground truth: $58,471 million (approximately $58.5 billion)
  - Generated: Insufficient context. The provided context does not mention JPMorgan Chase's net income in 2024 specifically. It only mentions revenue and net income for certain years, but not 2024.
  - Hallucination: Insufficient context. The provided context does not mention JPMorgan Chase's net income in 2024 spec
  - Why: Answer contains unsupported content not found in context and does not match expected keywords

- q03 (freeform)
  - Q: What was JPMorgan Chase's closing share price at end of 2024?
  - Ground truth: $239.71
  - Generated: Insufficient context.
  - Hallucination: Insufficient context.
  - Why: Answer contains unsupported content not found in context and does not match expected keywords

- q03 (citation_enforced)
  - Q: What was JPMorgan Chase's closing share price at end of 2024?
  - Ground truth: $239.71
  - Generated: Insufficient context.
  - Hallucination: Insufficient context.
  - Why: Answer contains unsupported content not found in context despite JSON format requirement

### 5 invalid outputs with failure reasons

- None in this run.

## Notes

- Freeform prompt: Natural language generation with optional citations.
- Citation-enforced prompt: Structured JSON output requirement with mandatory citations and confidence scoring.
- Hallucinations: Generated content not supported by the retrieved context.
- Invalid outputs: JSON parsing failures or missing required fields.

## End Result: Better Method and Why

- Better method: citation-enforced prompting.
- Why: it improved answer correctness and citation presence while maintaining full JSON validity, making outputs both more reliable and easier to evaluate automatically.