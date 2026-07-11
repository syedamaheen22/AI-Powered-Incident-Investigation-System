# Phase 2: Core System Implementation

## What It Is

Phase 2 focuses on building the core retrieval and reasoning infrastructure for the incident investigation system. This phase transforms the raw evidence layer (from Phase 1) into queryable, rankable data using hybrid search strategies and multi-source fusion.

The goal is to:

- Build a production-grade hybrid retrieval system combining vector and keyword search
- Implement cross-source data normalization and correlation
- Create a reasoning framework for multi-agent incident analysis
- Establish baseline evaluation metrics for retrieval and reasoning quality

## What We're Building

### Task 1: Build Hybrid RAG

Develop a retrieval system that combines multiple search strategies to improve context quality and relevance.

#### Requirements

- **Vector search using embeddings** — dense retrieval via semantic similarity
- **Keyword-based search (BM25 optional)** — sparse retrieval via exact term matching
- **Mechanism to combine and rank results** — merge and re-rank results from both methods

#### Design Decisions

**1. Embedding Model Selection**
- Use `nomic-embed-text:latest` (already available in local Ollama)
- Dimensions: 768
- Supports semantic search across logs, tickets, and runbook content
- Fast inference for real-time retrieval

**2. Vector Store**
- Use Chroma (already configured in project at `http://127.0.0.1:8000`)
- Pre-existing collections for Phase 1 data
- Supports hybrid search API with embedding reranking

**3. Keyword Search Strategy**
- BM25 via LangChain's `BM25Retriever`
- Built-in tokenization and relevance scoring
- No external dependencies needed

**4. Result Fusion Strategy**
- **Reciprocal Rank Fusion (RRF)** — merge rankings from both retrievers
- Weight both retriever scores equally (can be tuned)
- Re-rank fused results by combined score
- Top-K selection (default: 10 results per query)

#### Implementation Plan

**Step 1: Set Up Vector Collections**
- Load Phase 1 data into Chroma:
  - `logs_collection` — 500 log entries split into semantic chunks
  - `tickets_collection` — 100 incident tickets
  - `runbooks_collection` — 4 runbooks chunked by section
  - `deployments_collection` — 40 deployment records
- Each chunk includes metadata: `source`, `service`, `timestamp`, `type`

**Step 2: Implement Keyword Retriever**
- Build BM25 index from same Phase 1 data
- Create document store with chunked content and metadata
- Implement query preprocessing (tokenization, stemming optional)

**Step 3: Implement Vector Retriever**
- Query Chroma with embedding similarity search
- Configurable similarity threshold and top-K results
- Metadata filtering (e.g., filter by service, time range)

**Step 4: Build Fusion Layer**
- Implement RRF algorithm to combine vector and keyword scores
- Expose unified search interface: `hybrid_search(query, k=10, metadata_filter=None)`
- Return fused results with combined relevance scores

**Step 5: Build Query Expansion (Optional Enhancement)**
- Auto-expand queries with synonyms (e.g., "down" → "down, unavailable, offline, outage")
- Improve recall for domain-specific terminology
- Use LLM for context-aware expansion

#### Testing Strategy

**Unit Tests**
- Vector retriever returns expected chunks by similarity
- Keyword retriever returns exact-match and fuzzy-match results
- RRF correctly merges and re-ranks results
- Metadata filtering works as expected

**Integration Tests**
- End-to-end hybrid search on Phase 1 data
- Verify result quality and relevance
- Performance benchmarks (latency, recall, precision)

**Evaluation Queries**
- Simple queries: "auth-service down"
- Complex queries: "users cannot log in after deployment"
- Time-range queries: "incident at 14:00"
- Cross-service queries: "orders failing when payments slow"

#### Deliverables

- `scripts/phase2/hybridRAG.ts` — Hybrid search implementation
- `data/synthetic/phase2/vector_store_config.json` — Chroma collection metadata
- `docs/PHASE_2_CORE_SYSTEM.md` — This documentation
- Test suite with retrieval benchmarks
- Example queries and expected results

#### Why This Matters

The hybrid RAG system is the foundation for all downstream reasoning and analysis. Quality of retrieval directly impacts:
- Incident severity classification accuracy
- Root-cause analysis correctness
- Multi-agent reasoning quality
- Report generation relevance

---

### Task 2: Build Knowledge Graph

Model service dependencies as a graph to support structured reasoning about blast radius, dependency chains, and failure propagation.

#### Requirements

- **Dependency traversal** — walk downstream (what a service depends on) and upstream (what calls a service)
- **Impact analysis** — given a failed node, determine which services are affected and to what depth
- **Shortest path** — find the minimal dependency chain between any two nodes

#### Design Decisions

- **No external graph DB required** — graph is loaded from `knowledge_graph_step5.json` into in-memory adjacency lists
- **Directed graph** — edges represent directional relationships (`calls`, `depends_on`, `stores_in`)
- **BFS for impact analysis** — breadth-first traversal upstream to find full blast radius
- **DFS for dependency traversal** — depth-first traversal downstream to enumerate all transitive dependencies

#### Implementation

`scripts/phase2/knowledgeGraph.ts` implements the `KnowledgeGraph` class with:
- `traverseDownstream(nodeId)` — returns all transitive dependencies grouped by type
- `traverseUpstream(nodeId)` — returns all transitive callers
- `analyzeImpact(failedNodeId)` — returns full blast radius with impacted services, depth, and relationship chains
- `shortestPath(from, to)` — BFS to find minimal path between two nodes
- `getSummary()` — graph statistics including node degrees and edge breakdown

#### Key Findings

- `auth-service` has the highest connectivity (degree 7) — central point of failure
- `redis-cache` failure cascades to all 5 services (widest blast radius)
- `gateway-service` transitively depends on all 11 other nodes in the graph

#### Deliverables

- `scripts/phase2/knowledgeGraph.ts` — Graph engine with traversal and impact analysis
- `data/synthetic/phase2/knowledge_graph_analysis.json` — Traversal results, impact reports, shortest paths

#### Why This Matters

The knowledge graph enables agents to reason about *which* services are affected and *why*, beyond what raw log text alone can tell. It powers the Graph Agent in the multi-agent pipeline and informs blast radius estimation in incident reports.

---

### Task 3: Build a Multi-Agent System

Design a multi-agent workflow where each agent is responsible for a specific part of the investigation process, operating sequentially and passing shared context forward.

#### Required Agents

| Agent | Responsibility | Method |
|---|---|---|
| **Planner Agent** | Breaks the user query into investigation steps, identifies key services and time window | LLM + Zod structured output |
| **Log Analysis Agent** | Detects anomalies, clusters related error patterns, summarizes findings | Pattern matching + LLM summary |
| **Timeline Agent** | Builds chronological sequence of events from logs, deployments, and tickets | Merge + sort + LLM narration |
| **Graph Agent** | Identifies affected services via dependency traversal and blast radius | BFS graph traversal + LLM summary |
| **Hypothesis Agent** | Generates 3 distinct root cause hypotheses with evidence and confidence levels | LLM + Zod structured output |
| **Critic Agent** | Verifies each hypothesis against the evidence bank, confirms or rejects | LLM + Zod structured output |
| **Report Generator** | Produces the final Markdown incident investigation report | LLM freeform generation |

#### Architecture

All agents share an `InvestigationContext` object that is passed forward through the pipeline. Each agent reads from and writes to this context:

```
User Query
    ↓
[Planner Agent]        → plan (steps, key services, time window)
    ↓
[Log Analysis Agent]   → log_analysis (clusters, error count, anomaly window)
    ↓
[Timeline Agent]       → timeline (sorted events, narrative, incident start)
    ↓
[Graph Agent]          → graph_analysis (blast radius, dependency chains)
    ↓
[Hypothesis Agent]     → hypotheses (3 root causes with confidence)
    ↓
[Critic Agent]         → critique (verified verdicts, final root cause)
    ↓
[Report Generator]     → incident_report.md
```

#### Deliverables

- `scripts/phase2/multiAgent.ts` — Full multi-agent orchestration pipeline
- `data/synthetic/phase2/multi_agent_investigation.json` — Complete agent outputs as structured JSON
- `data/synthetic/phase2/incident_report.md` — Final Markdown incident report

#### Why This Matters

Each agent is specialised and focused — no single LLM call is overloaded with too much context. The sequential pipeline mirrors how a real SRE team investigates: plan first, gather evidence, identify impact, hypothesize, verify, then report.

---

## Output Artifacts Summary

| File | Task | Description | Use Case |
|---|---|---|---|
| `data/synthetic/phase2/hybrid_rag_results.json` | Task 1 | Results of 4 hybrid search queries plus a filtered search example | Validate retrieval quality and relevance of BM25 + vector fusion |
| `data/synthetic/phase2/knowledge_graph_analysis.json` | Task 2 | Dependency traversal, impact analysis, and shortest paths for key services | Structured reasoning about service blast radius and failure propagation |
| `data/synthetic/phase2/multi_agent_investigation.json` | Task 3 | Full structured output from all 7 agents (plan, logs, timeline, graph, hypotheses, critique) | Audit trail for each agent's reasoning |
| `data/synthetic/phase2/incident_report.md` | Task 3 | Final Markdown incident report generated by the Report Generator agent | Human-readable post-incident report for stakeholders |

---

## What We're Tracking

Progress on Phase 2 implementation will be documented in this file as each task/step is completed.

| Task | Status | Script | Output |
|---|---|---|---|
| Task 1: Hybrid RAG | ✅ Complete | `scripts/phase2/hybridRAG.ts` | `hybrid_rag_results.json` |
| Task 2: Knowledge Graph | ✅ Complete | `scripts/phase2/knowledgeGraph.ts` | `knowledge_graph_analysis.json` |
| Task 3: Multi-Agent System | ✅ Complete | `scripts/phase2/multiAgent.ts` | `multi_agent_investigation.json`, `incident_report.md` |

## Why This Matters for Next Phases

Once hybrid retrieval is working, Phase 3 can focus on:

- Multi-agent incident reasoning with retrieved context
- Automated root-cause inference from correlated evidence
- Timeline construction from logs and tickets
- Explainable report generation with evidence traces
