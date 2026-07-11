# Day 13 - Knowledge Graph Framework Comparison for Agentic GenAI

## Scope

This report compares three KG-related tools/frameworks across:
- problem solved
- integration with LLMs/agents
- support for reasoning, validation, and control
- practical strengths and limits for RAG/agent systems

It also includes a minimal hands-on example run from this repo.

## Tools Evaluated

1. Neo4j (graph database)
2. Memgraph (graph database + graph/AI ecosystem)
3. LlamaIndex PropertyGraphIndex (LLM + KG framework)

## Comparison Table

| Tool | Purpose and abstraction level | Ease of integration with agents/RAG | What problem it solves | LLM/agent integration pattern | Reasoning / validation / control support | Strengths | Limitations |
|---|---|---|---|---|---|---|---|
| Neo4j | Low-to-mid abstraction. Production property graph database with Cypher query model. | Medium. Strong ecosystem, but requires graph modeling and query design. | Persistent multi-hop relationship retrieval, entity-centric memory, graph analytics at scale. | Common patterns: Text-to-Cypher, GraphRAG retrieval + vector retrieval, tool call to Cypher endpoint from agent loop. | Reasoning: via explicit graph traversals and path constraints. Validation: schema/security constraints, RBAC, controlled query templates. Control: strong operational controls and query governance. | Mature enterprise tooling, high performance for connected data, broad integration options. | Higher modeling and ops effort than plain vector DB RAG; can be overkill for simple Q&A. |
| Memgraph | Low-to-mid abstraction. Real-time/streaming graph DB with Cypher compatibility and MAGE algorithms. | Medium-to-high for teams using streaming/event pipelines and graph procedures. | Real-time connected data analysis, online graph updates, graph analytics + search over dynamic relations. | Agent as tool-caller for Cypher/procedures; GraphRAG and agentic GraphRAG patterns in docs; MCP/agent ecosystem support. | Reasoning: path queries + graph algorithms. Validation: constraints/privileges and query controls. Control: streaming + module-based workflow controls. | Good for low-latency graph updates, algorithm-rich (MAGE), practical AI ecosystem docs. | Smaller enterprise footprint than Neo4j in some orgs; requires graph expertise and infrastructure planning. |
| LlamaIndex PropertyGraphIndex | Mid-to-high abstraction in app layer. KG extraction/retrieval framework above storage. | High for Python-based agent/RAG applications already using LlamaIndex. | Rapid KG extraction from documents and hybrid graph retrieval inside LLM pipelines. | Build graph via extractors; retrieve with synonym/vector/cypher/template retrievers; plug into query engine/agents. | Reasoning: retrieval over graph paths and hybrid retrievers. Validation: SchemaLLMPathExtractor and optional strict schema constraints. Control: Cypher template retrieval and custom retriever hooks for safer control. | Fast experimentation, composable retrievers, supports multiple graph stores (including Neo4j). | Quality depends on extraction prompts/models; still needs careful governance for generated Cypher and schema drift. |

## Tool Snapshot

- **Neo4j**: Production-grade, mature, strong for multi-hop retrieval and governance, but higher ops overhead
- **Memgraph**: Real-time streaming graphs, algorithm-rich (MAGE), good AI ecosystem, but smaller footprint than Neo4j
- **LlamaIndex PropertyGraphIndex**: Fastest to experiment with in Python RAG pipelines, composable retrievers, but quality depends on extraction quality

## Hands-on Example (Run in Repo)

### What was implemented

A minimal KG lookup flow was built and run in:
- `tasks/day13/kgHandsOnComparison.ts`

It does:
1. Load simple entities/relations (city, places, cuisine, budget/tag relations).
2. Query the graph for constraints (city + tag + budget).
3. Integrate lookup into a minimal agent-style route -> lookup -> respond flow.

### Output artifact

Run output is written to:
- `docs/day13/day13-kg-hands-on-results.json`

Observed run summary:
- entities loaded: 5
- relations loaded: 11
- sample grounded result for query `(berlin, art, cheap)`: `East Side Gallery` + `Street Food Markets`

### How to run

```bash
npm run run:day13-kg
```

## Notes from Agent Pattern References

Based on the provided references:
- ReAct-style loops are well-suited for dynamic tool choice and iterative graph lookup.
- Plan-and-Execute is often better for larger multi-step workflows where you want explicit decomposition before retrieval/execution.
- In KG-enabled systems, a common hybrid is:
  1. planner decides if graph retrieval is needed,
  2. executor performs constrained graph queries,
  3. responder synthesizes grounded answer.

## Short Summary: When KG Makes Sense vs Overkill

### When knowledge graphs make sense in GenAI systems

Use KG when you need one or more of the following:
- multi-hop reasoning over explicit relationships
- strict entity disambiguation and canonical IDs
- explainable retrieval paths (why this answer)
- governance and controlled semantics in high-risk domains
- joining heterogeneous enterprise data where relations matter more than text similarity

### When KG is overkill

KG is usually overkill when:
- use cases are primarily unstructured semantic search where vector-only retrieval is enough
- data changes are simple and relations are shallow/non-critical
- team cannot maintain ontology/schema and graph ops
- latency/cost budget favors a simpler retriever stack without graph construction
- no requirement for path-level explainability or relationship constraints

## Practical Recommendation

Start with vector RAG + metadata filters, then add KG selectively for the slices that actually require relationship-aware retrieval or controllable reasoning. This reduces complexity while preserving a migration path to graph-enhanced agents.
