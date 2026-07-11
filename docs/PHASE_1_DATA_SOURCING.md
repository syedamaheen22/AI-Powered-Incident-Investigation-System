# Phase 1: Data Sourcing

## What It Was

Phase 1 focused on building the initial dataset foundation for the incident investigation system using realistic and controllable data.

The goal was to combine:

- Real-world/public incident-style data patterns (Kaggle/public datasets)
- LLM-generated synthetic operational data for controlled failure scenarios
![alt text](image.png)
This phase establishes the raw evidence layer required for later phases such as retrieval, reasoning, timeline construction, and report generation.

## What We Did

### 1. Defined Phase 1 Strategy

We documented and aligned the data sourcing approach in the project documentation:

- Use public data to capture natural variance and noisy behavior
- Use synthetic generation to inject known failure patterns and edge cases

### 2. Implemented Synthetic Log Generation (Step 1)

Created a TypeScript generator:

- Script: `scripts/phase1/generateSyntheticLogs.ts`
- Output: `data/synthetic/phase1/logs_step1.json`

The script generates exactly 500 production-style microservice logs with:

- `timestamp` (ISO format)
- `service` in `{auth, payments, orders, gateway}`
- `level` in `{INFO, WARN, ERROR}`
- `message`
- `request_id`

### 3. Added Real-World Noise and Inconsistency

To mimic real operational environments, the generated logs include:

- Occasional missing fields
- Inconsistent schema variants (`ts/svc/lvl/reqId`)
- Mixed quality records to stress downstream normalization

### 4. Injected Incident Behavior

A failure scenario is intentionally injected starting at `14:00`:

- Error probability increases gradually over time
- Dependency-related failures appear across services
- Warning signals and degradation markers precede severe errors
- Escalation indicators are added later in the incident window

### 5. Resolved Generator Quality Issues

During implementation, strict TypeScript errors were fixed to ensure stable generation:

- Safe array picking under strict typing
- Exact optional property handling for inconsistent records

### 6. Executed and Verified Output

The generator was run successfully and produced:

- `500` logs
- File location: `data/synthetic/logs_step1.json`

---

### 7. Generated Incident Tickets (Step 2)

Created a TypeScript generator using LangChain + Ollama (`llama3`) with structured output (Zod schema):

- Script: `scripts/phase1/generateIncidentTickets.ts`
- Output: `data/synthetic/phase1/tickets_step2.json`

The script generates exactly 100 production-style incident tickets across 10 themed batches:

- `ticket_id` (`INC-2001` → `INC-2100`)
- `title`
- `description` (natural language, operator tone)
- `service` in `{auth-service, payments-service, orders-service, gateway-service}`
- `timestamp` (ISO format, 2026-04-10)
- `resolution` (optional, ~60% of tickets)

Realism features injected:

- Duplicate issues expressed with different wording and reporter framing (e.g. "Users cannot log in" vs "Auth-service not responding")
- Partial understanding tickets (e.g. reporter correctly identifies high latency but blames the wrong service)
- Incorrect root-cause assumptions (e.g. blaming the database when a JWT secret misconfiguration is the real cause)

---

### 8. Generated Service Runbooks (Step 3)

Created a TypeScript generator using LangChain + Ollama (`llama3`) for free-form Markdown output:

- Script: `scripts/phase1/generateRunbooks.ts`
- Output: `data/synthetic/phase1/runbooks/`

One runbook generated per service:

| File | Service |
|---|---|
| `auth-service-runbook.md` | auth-service |
| `payments-service-runbook.md` | payments-service |
| `orders-service-runbook.md` | orders-service |
| `gateway-service-runbook.md` | gateway-service |

Each runbook contains:

- **Overview** — what the service does
- **Dependencies** — upstream/downstream services with notes
- **Common Issues** — 4–6 realistic failure modes
- **Troubleshooting Steps** — numbered steps with `kubectl`/`grep` commands, vague real-doc language ("check with the platform team", "usually resolves itself after a few minutes"), and at least one outdated or partially wrong assumption
- **Escalation Policy** — service owner, Slack channel, PagerDuty on-call rotation
- **Known Limitations / TODOs** — honest gaps in monitoring and runbook coverage ("no one has done this yet", "we should probably…")

---

### 9. Generated Deployment History (Step 4)

Created a TypeScript generator using LangChain + Ollama (`llama3`) with structured output (Zod schema):

- Script: `scripts/phase1/generateDeploymentHistory.ts`
- Output: `data/synthetic/phase1/deployments_step4.json`

The script generates exactly 40 deployment records organized in 4 chronological batches:

- **Batch 1** (10:00–11:30 UTC) — routine pre-incident deployments
- **Batch 2** (11:30–12:30 UTC) — mid-morning deployments with natural version progression
- **Batch 3** (12:30–13:55 UTC) — **critical breaking changes** (auth-service token validation refactor, payments-service gateway integration) marked with `is_breaking_change: true`
- **Batch 4** (14:00–14:30 UTC) — emergency rollbacks and hotfixes in response to the incident

Each deployment record includes:

- `service` — one of {auth-service, payments-service, orders-service, gateway-service}
- `version` — semantic version (e.g., v2.1.3, v1.8.0-hotfix.1)
- `timestamp` — ISO format, 2026-04-10 UTC
- `change_description` — 1–2 sentences describing the change
- `is_breaking_change` (optional) — boolean flag for breaking changes

Realism features:

- Version progression follows semantic versioning with natural increments
- Pre-incident deployments are routine (bug fixes, feature additions, dependency updates)
- Breaking changes are timestamped 15–30 minutes before incident onset, creating a clear causal link
- Post-incident deployments show rapid rollbacks and hotfixes (multiple deployments within minutes)

---

### 10. Generated Knowledge Graph (Step 5)

Created a deterministic TypeScript generator for service dependency topology:

- Script: `scripts/phase1/generateKnowledgeGraph.ts`
- Output: `data/synthetic/phase1/knowledge_graph_step5.json`

The knowledge graph is static (no LLM) and defines the complete microservices architecture:

**Nodes (12 total)**

| Service | Type | Owner | Region | Purpose |
|---|---|---|---|---|
| auth-service | service | team-auth | us-east-1 | User authentication, token management |
| orders-service | service | team-orders | us-east-1 | Order creation, fulfillment |
| payments-service | service | team-payments | eu-west-1 | Payment processing |
| gateway-service | service | team-platform | us-east-1 | API gateway, routing |
| notifications-service | service | team-platform | us-east-1 | Email, SMS delivery |
| redis-cache | storage | team-platform | us-east-1 | Session storage, distributed cache |
| user-db | storage | team-auth | us-east-1 | User credentials, profiles |
| orders-db | storage | team-orders | us-east-1 | Order records, state |
| payments-db | storage | team-payments | eu-west-1 | Payment transactions, ledger |
| stripe-gateway | external | stripe-inc | global | Third-party payment processor |
| ldap-service | external | corporate-it | us-east-1 | SSO provider |
| sendgrid-api | external | sendgrid | global | Email delivery service |

**Edges (16 total)**

Example dependencies:

- `auth-service` → `redis-cache` (stores_in) — session storage
- `auth-service` → `user-db` (stores_in) — credential lookup
- `orders-service` → `auth-service` (calls) — token validation
- `orders-service` → `payments-service` (calls) — charge processing
- `payments-service` → `stripe-gateway` (depends_on) — external payment processing
- `gateway-service` → {auth, orders, payments} (calls) — ingress routing

Relationship types: `depends_on`, `calls`, `stores_in`, `notifies`

---

## Data Artifacts Summary

| File | Description | Use Case |
|---|---|---|
| `logs_step1.json` | 500 system logs with noise, inconsistencies, missing fields | Time-series analysis, event reconstruction |
| `tickets_step2.json` | 100 incident tickets with duplicates, misunderstandings, wrong assumptions | Incident triage, correlation logic |
| `deployments_step4.json` | 40 deployments with 8 breaking changes (15–55 min before incident) | Root-cause analysis, causal link detection |
| `knowledge_graph_step5.json` | 12 nodes, 16 edges (services, storage, external, ownership, regions) | Dependency impact analysis, cascade reasoning |
| `runbooks/` | 4 troubleshooting guides with vague steps and wrong assumptions | SRE procedure matching, doc-based reasoning |

---

## File Descriptions

### data/synthetic/phase1/logs_step1.json
Contains 500 system logs with timestamps, services, log levels, and messages. Includes inconsistencies and missing fields to simulate real-world operational noise. Used for time-series analysis and event sequence reconstruction during incident investigation.

### data/synthetic/phase1/tickets_step2.json
Stores 100 incident tickets with natural language descriptions, service assignments, and optional resolutions. Includes duplicate issues expressed with different wording, partial misunderstandings, and incorrect root-cause assumptions to stress incident triage and correlation logic.

### data/synthetic/phase1/deployments_step4.json
Tracks 40 service deployments with versions and change descriptions, timestamped chronologically on 2026-04-10. Includes 8 breaking changes (marked with `is_breaking_change: true`) deployed 15–55 minutes before incident onset, establishing a causal link for root-cause analysis.

### data/synthetic/phase1/knowledge_graph_step5.json
Represents the system's complete knowledge graph with 12 nodes (5 internal services, 5 storage/databases, 2 external systems) and 16 edges (dependencies, relationships). Includes service ownership, deployment regions, and relationship type to enable cross-service impact analysis and dependency chain reasoning.

### data/synthetic/phase1/runbooks/
Directory containing 4 troubleshooting guides (`auth-service-runbook.md`, `payments-service-runbook.md`, `orders-service-runbook.md`, `gateway-service-runbook.md`). Each includes common issues, troubleshooting steps with specific commands, escalation policies, and intentionally vague or partially incorrect instructions to simulate real internal SRE documentation.

## Deliverables Produced in Phase 1

- Phase 1 strategy documented in README
- Synthetic log generation script → `data/synthetic/phase1/logs_step1.json` (500 logs)
- Incident ticket generation script → `data/synthetic/phase1/tickets_step2.json` (100 tickets)
- Runbook generation script → `data/synthetic/phase1/runbooks/` (4 service runbooks)
- Deployment history generation script → `data/synthetic/phase1/deployments_step4.json` (40 records with breaking changes)
- Knowledge graph generation script → `data/synthetic/phase1/knowledge_graph_step5.json` (12 nodes, 16 edges)

## Why This Matters for Next Phases

This dataset now enables:

- Retrieval experiments (vector + keyword)
- Cross-source correlation design
- Multi-agent incident reasoning prototypes
- Explainable root cause report generation with evidence traces
