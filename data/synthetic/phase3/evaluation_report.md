# Phase 3 Evaluation Report

Overall score: 0.93

## Dimension Scores

- Retrieval Quality: 0.92 (strong)
  Average top-result score is 0.040, 3 source types appear in top results, and 2/4 queries are led by logs.
- Faithfulness: 0.80 (strong)
  Root cause is backed by 12 citations, but cross-checking evidence shows 1 contradicting evidence items and potential tension between auth-related and payments-related evidence.
- Reasoning: 1.00 (strong)
  5 evidence source categories, 8 dependency chains, and 3 candidate hypotheses contribute to multi-source reasoning.
- Explainability: 1.00 (strong)
  12 citations are included, with 5 marked high relevance and claim-to-evidence mapping present in the explainability trace.
- Robustness: 0.85 (strong)
  The system handled 500 logs and still produced outputs despite messy data, but 0 timeline events are missing timestamps, which lowers robustness.
- Agent Coordination: 1.00 (strong)
  6/6 core agent outputs were produced, and graph analysis did contribute non-empty failed service results.
