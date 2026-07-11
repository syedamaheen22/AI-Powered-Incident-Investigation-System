# Day 6: Chunking Strategy Experiment (E10)

## Goal

1. Index the same corpus with three chunking strategies:
- fixed-size
- overlapping
- advanced recursive
2. Run the same question set across all three indexes.
3. Produce:
- hit-rate@5 comparison table for all three strategies
- 5 cases where advanced chunking improved retrieval
- 3 cases where advanced chunking performed worse

## Script

- Task script: tasks/day6/chunkingStrategyCompare.ts
- Command: npm run run:day6-chunking

## Input Files

- docs/pdf-test-set.json
- data/pdfs/JPM-full.txt
- data/pdfs/JNJ-full.txt

## Output Files

- docs/day6/day6-chunking-results.json
- docs/day6/DAY6_CHUNKING_REPORT.md

## Environment

- Chroma server: http://127.0.0.1:8000 by default
- Ollama embeddings endpoint: http://127.0.0.1:11434/api/embeddings
- Default embedding model: nomic-embed-text

Optional overrides:

- DAY6_TOP_K (default 5)
- DAY6_FIXED_WORDS (default 180)
- DAY6_OVERLAP_WORDS (default 60)
- DAY6_RECURSIVE_MAX_WORDS (default 180)
- CHROMA_HOST, CHROMA_PORT
- OLLAMA_BASE_URL
- RAG_EMBED_MODEL
