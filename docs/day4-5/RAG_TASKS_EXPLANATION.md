# E7, E8, F8 Task Explanation and Implemented Solution

## 1) What the two tasks were

### Task E7 (Build + Run)
Build a simple RAG pipeline using:
- embeddings
- top-k retrieval
- a single prompt for answering

Then run the same 25 questions from Week 1 Day 4.

### Task E8/F8 (Evaluation + Comparison)
Using the same setup:
- use Chroma DB as vector database
- ingest documents using simple fixed word chunking (no advanced chunking)
- generate embeddings for each chunk and store them in Chroma DB
- answer with an open-source LLM using Chroma retrieval
- compare against a baseline that sends full document text directly to the LLM (no retrieval)

Output required:
- comparison of RAG vs full-text LLM
- answer correctness
- failure cases: missed info, hallucination, truncation
- short conclusion: where basic RAG helped and where it did not

## 2) Important terms (simple definitions)

- RAG (Retrieval-Augmented Generation): Retrieve relevant text chunks first, then ask the LLM to answer using that retrieved context.
- Embedding: A numeric vector representation of text meaning.
- Vector database: Stores embeddings and finds semantically similar vectors quickly.
- Chroma DB: The vector database used in this project.
- Chunking: Splitting long text into smaller parts before embedding.
- Fixed word chunking: Split text every N words (simple strategy).
- Top-k retrieval: Return the k most relevant chunks for a question.
- Baseline (full-text): Give entire source text to LLM directly without retrieval.
- Hallucination: Model output includes unsupported or invented facts.
- Missed info: Correct information exists in source but answer misses it.
- Truncation: Incomplete/cut-off answer.

## 3) What was implemented

Implementation file:
- tasks/ragPdfEvaluate.ts

Generated outputs:
- docs/rag-pdf-eval-results.json
- docs/RAG_PDF_EVAL_REPORT.md

### Pipeline implementation details

1. Load source texts and 25-question test set.
2. Split source documents into simple fixed chunks:
- chunk size: 180 words
- overlap: 0 (kept simple)
3. Generate embeddings for chunks using an open-source embedding model via Ollama (nomic-embed-text).
4. Store chunk embeddings + metadata in Chroma collection.
5. For each question:
- Baseline mode: full document text prompt (no retrieval)
- RAG mode: embed query, retrieve top-k chunks from Chroma, answer from retrieved context
6. Score both answers for:
- correctness
- citation presence
- keyword recall
- refusal correctness for unanswerable questions
7. Classify failure cases:
- missed_info
- hallucination
- truncation
8. Write JSON and Markdown comparison report.

## 4) Run results summary

From docs/RAG_PDF_EVAL_REPORT.md:

- Full-text baseline: 2/25 correct (8.0%)
- Basic RAG: 14/25 correct (56.0%)

Failure counts:

- Full-text baseline:
- missed_info: 23
- hallucination: 2
- truncation: 0

- Basic RAG:
- missed_info: 11
- hallucination: 1
- truncation: 0

Conclusion:
- Basic RAG helped mainly by narrowing long context to relevant chunks.
- Basic RAG still failed when retrieved chunks were incomplete/mixed, causing missed values or wrong numeric answers.

## 5) Required output format (submission-ready)

1) Results comparison:
- RAG vs full-text LLM answering
- answer correctness
- failure cases (missed info, hallucination, truncation)

2) Short conclusion:
- where basic RAG helped
- where it did not

## 6) How to run

1. Start Ollama and ensure required models are available:
- llama3
- nomic-embed-text

2. Start Chroma:
- .venv/bin/chroma run --host 127.0.0.1 --port 8000 --path ./chroma

3. Run evaluation:
- npm run run:rag-pdf-eval

This command runs the full E7 + E8/F8 workflow and regenerates output files.
