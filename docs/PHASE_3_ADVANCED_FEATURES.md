# Phase 3: Advanced Features Integration

## What It Adds

Phase 3 packages the Phase 2 investigation pipeline into a more usable, explainable system.

Implemented capabilities:

- **Streaming Responses** via `streaming_insights.json` with ordered incremental insights
- **Incident Memory** via `incident_memory.json` that stores recurring patterns and past incidents
- **User Feedback Loop** via `user_feedback.json` template consumed during confidence calibration
- **Confidence Calibration** via `confidence_calibration.json` with explicit validation factors
- **Interactive UI Dashboard** via `dashboard.html`
- **Explainability Enhancements** via `explainability_trace.json` mapping claims to evidence

## Code

- `scripts/phase3/advancedFeatures.ts`

## Outputs

- `data/synthetic/phase3/final_incident_report.json`
- `data/synthetic/phase3/final_incident_report.md`
- `data/synthetic/phase3/dashboard.html`
- `data/synthetic/phase3/streaming_insights.json`
- `data/synthetic/phase3/explainability_trace.json`
- `data/synthetic/phase3/confidence_calibration.json`
- `data/synthetic/phase3/incident_memory.json`
- `data/synthetic/phase3/user_feedback.json`
- `data/synthetic/phase3/evaluation_report.json`
- `data/synthetic/phase3/evaluation_report.md`

## Evaluation Criteria

Phase 3 includes an explicit evaluation step in `scripts/phase3/evaluateSystem.ts` that scores the system on the following dimensions:

- **Retrieval Quality** — whether the most relevant documents and records are retrieved
- **Faithfulness** — whether the final answer is grounded in available evidence
- **Reasoning** — whether evidence is connected across multiple sources
- **Explainability** — whether citations and supporting references are present
- **Robustness** — whether the pipeline tolerates incomplete or messy data
- **Agent Coordination** — whether each agent contributes meaningful output to the workflow

The evaluator writes both JSON and Markdown artifacts so the system can be reviewed programmatically and by humans.

## Final Report Shape

The generated final report includes:

- Root cause analysis
- Timeline of events
- Affected services
- Supporting evidence / citations
- Confidence score
- Recommended actions