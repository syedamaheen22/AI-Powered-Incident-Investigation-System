# LLM Behavior Cheatsheet

This cheatsheet summarizes what changed when running 10 prompts at temperature 0, 0.7, and 1.

## What Changes Output (and Why)

1. Temperature
Higher temperature increases randomness during token sampling, so wording and structure vary more between runs.
2. Prompt specificity
Tight constraints (for example, exact bullet count or JSON-only) reduce variation because the model has fewer valid outputs.
3. Output length limits
Lower max output tokens forces concise answers and can truncate elaboration, reducing perceived creativity.
4. Model choice
Different models use different training, alignment, and decoding defaults, which shifts style, depth, and consistency.
5. Hidden context and instruction hierarchy
System/developer instructions and conversation history strongly shape outputs even when user prompts are identical.

## Observed in This Assignment

| Temperature | Avg Words | Avg Chars | Avg Latency (ms) |
|---|---:|---:|---:|
| 0 | 110.1 | 681.5 | 7909.1 |
| 0.7 | 114.7 | 695.9 | 7740.2 |
| 1 | 113.6 | 707 | 7665.2 |

- Mean lexical similarity across temperature outputs: 0.412
- Lower similarity indicates higher variation in wording and phrasing.

## Practical Temperature Guide

- Temp 0: Use for deterministic tasks (tests, strict transformations, reproducible outputs).
- Temp 0.7: Use for balanced quality and creativity (most product and assistant writing).
- Temp 1: Use for brainstorming and alternatives where novelty matters more than consistency.

## Recommendation for Reports

- If the assignment asks for reliability, use temp 0 with strict prompt constraints.
- If the assignment asks for creativity comparison, include temp 1 examples side by side with temp 0.
- Always log prompt, model, temperature, and token limits for reproducibility.