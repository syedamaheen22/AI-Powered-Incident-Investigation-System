# Assignment Summary: AI-Powered Incident Investigation System

## The Real-World Scenario

Imagine your company's website goes down at 2 PM. Users cannot log in. Orders are failing. Payments are broken.

Normally a senior engineer would manually:
1. Check thousands of log lines
2. Look at recent deployments
3. Read through support tickets
4. Map which services depend on which
5. Form a hypothesis about what broke
6. Write an incident report

**This assignment makes an AI do all of that automatically.**

---

## What the System Does — Step by Step

| Agent | Role | What it did in this investigation |
|---|---|---|
| Planner | Breaks the query into investigation steps | Decided to investigate auth-service, orders-service, payments-service |
| Log Analyst | Scans logs for anomalies and error clusters | Found 185 errors across 500 logs, spotted a spike starting at 13:52 UTC |
| Timeline Builder | Orders every event chronologically | Built a sequence of all deployments and errors across the incident window |
| Graph Analyst | Maps service dependencies and blast radius | Knew that auth → orders → payments → gateway are connected |
| Hypothesis Agent | Generates candidate root causes | Produced 3 theories about what broke |
| Critic | Checks each theory against evidence | Verified 1 confirmed and 1 plausible hypothesis |
| Report Writer | Produces the final structured report | Wrote the grounded incident report with citations and confidence score |

---

## What the System Found (Actual Output)

**Root Cause:**
Three breaking deployments were pushed before the incident — one to payments at 12:43, one refactoring token validation in auth at 12:49, and a major upgrade at 13:55. The system traced the cascade from auth through to orders and payments automatically.

**Conflict Detected:**
Some support tickets blamed the database or the frontend, but logs clearly showed the failures were in auth/token logic and backend dependencies. The system caught that disagreement and flagged it.

**Timeline:**
- 12:43 — payments-service v1.7.3-hotfix.2 deployed with stricter error handling [BREAKING]
- 12:49 — auth-service v1.9.5 deployed, refactoring token validation [BREAKING]
- 13:52 — Error spike begins in logs
- 13:55 — payments-service v1.8.0 major upgrade deployed [BREAKING]
- 14:00 — Users start reporting login failures and order errors
- 14:03 — Incident peak

**Affected Services:** auth-service, orders-service, payments-service, gateway-service, Kafka

**Confidence Score:** 0.98

---

## The Three Phases

### Phase 1 — Data Creation
Build realistic, messy incident data that mirrors what real production systems look like:
- 500 logs with inconsistent formats and missing fields
- 100 support tickets including duplicates and wrong assumptions
- Deployment history with breaking changes before the incident
- Runbooks with vague instructions (as in real companies)
- A service dependency graph
- Public/Kaggle incident data merged with the synthetic data

### Phase 2 — Core Intelligence
Build the AI brain:
- **Hybrid RAG**: retrieve relevant evidence using both vector search and keyword (BM25) search
- **Knowledge Graph**: understand which services depend on which, and trace cascading failures
- **Multi-Agent System**: 7 agents each handling one part of the investigation:
  1. **Planner** — breaks the query into investigation steps
  2. **Log Analysis Agent** — detects anomalies and clusters related errors
  3. **Timeline Agent** — builds the chronological sequence of events
  4. **Graph Agent** — identifies affected services through dependency relationships
  5. **Hypothesis Agent** — generates possible root cause explanations
  6. **Critic Agent** — verifies each hypothesis against supporting evidence
  7. **Report Generator** — produces the final structured incident report

The system also had to handle real challenges:
- Missing/inconsistent data
- Conflicting evidence (tickets vs logs)
- Temporal reasoning (what changed before failure)
- Multi-hop reasoning (auth failure → orders failure → payments failure)
- Source ranking (logs trusted more than tickets, tickets more than runbooks)

### Phase 3 — Advanced Features
Make the system production-ready:
- **Streaming**: show investigation steps as they happen
- **Incident Memory**: remember past incidents to spot patterns
- **Feedback Loop**: let users confirm or correct the root cause
- **Confidence Calibration**: score reliability using multiple signals
- **Dashboard**: visual HTML interface for the results
- **Explainability**: every claim is backed by cited evidence

---

## Final Report Output

The system produces a complete incident report containing:

| Field | Output |
|---|---|
| Root Cause | payments-service breaking deployment + auth-service token validation refactor |
| Timeline | 12 timestamped events from first deployment to incident peak |
| Affected Services | auth-service, orders-service, payments-service, gateway-service, Kafka |
| Evidence/Citations | 10 citations from logs, deployments, graph, tickets, runbooks |
| Confidence Score | 0.98 |
| Recommended Actions | Rollback, regression tests, improved dependency monitoring |

---

## Evaluation Scores

| Criterion | Score | Meaning |
|---|---|---|
| Retrieval Quality | 0.92 | Strong retrieval across 3 source types (logs, deployments, tickets) in top results; 2 of 4 queries led by logs |
| Faithfulness | 0.80 | Root cause backed by 12 citations; flags 1 contradicting evidence item (auth vs. payments signals) instead of suppressing |
| Reasoning | 1.00 | Evidence connected across 5 source categories with 8 dependency chains and 3 candidate hypotheses |
| Explainability | 1.00 | All claims tagged with source; 5 citations marked high-relevance; full claim-to-evidence mapping provided |
| Robustness | 0.85 | Handled 500 logs with complete timestamps; processed conflicting data gracefully |
| Agent Coordination | 1.00 | All 6 core agents produced outputs; graph analysis contributed non-empty failed service results |
| **Overall** | **0.93** | Strong performance across all dimensions |

---

## In One Sentence

Built an AI that investigates production outages the way a senior SRE would — reading logs, tickets, and deployment history, reasoning across them, and writing a grounded report with citations and a confidence score.
