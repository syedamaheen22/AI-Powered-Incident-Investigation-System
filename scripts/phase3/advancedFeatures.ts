import fs from "fs";
import path from "path";

type Verdict = "confirmed" | "plausible" | "rejected";

interface EvidenceCitation {
  source: string;
  reference: string;
  snippet: string;
  relevance: "high" | "medium" | "low";
}

interface Phase2Investigation {
  generated_at: string;
  user_query: string;
  plan?: {
    incident_summary: string;
    investigation_steps: string[];
    key_services: string[];
    time_window: string;
  };
  log_analysis?: {
    total_logs_analyzed: number;
    error_count: number;
    anomaly_window: string;
    top_errors: string[];
    clusters: Array<{
      pattern: string;
      services: string[];
      count: number;
      severity: string;
      sample_messages: string[];
    }>;
    llm_summary: string;
  };
  timeline?: {
    events: Array<{
      timestamp: string;
      type: "log" | "deployment" | "ticket";
      service: string;
      event: string;
      severity?: string;
    }>;
    narrative: string;
    incident_start: string;
    incident_peak: string;
  };
  graph_analysis?: {
    failed_services: string[];
    blast_radius: Record<string, string[]>;
    dependency_chains: Array<{ from: string; to: string; path: string[] }>;
    llm_summary: string;
  };
  hypotheses?: {
    hypotheses: Array<{
      id: string;
      root_cause: string;
      evidence: string[];
      confidence: "high" | "medium" | "low";
      affected_services: string[];
    }>;
    most_likely: string;
  };
  critique?: {
    verified_hypotheses: Array<{
      hypothesis_id: string;
      verdict: Verdict;
      reasoning: string;
      supporting_evidence: string[];
      contradicting_evidence: string[];
    }>;
    final_root_cause: string;
  };
  conflict_analysis?: {
    conflicts: Array<{
      ticket_id: string;
      ticket_claim: string;
      contradiction: string;
      evidence_source: string;
    }>;
    summary: string;
  };
  resolution?: {
    selected_root_cause: string;
    supporting_evidence: string[];
    confidence_score: number;
    top_candidate_service: string;
  };
}

interface HybridResultSet {
  query_results: Array<{
    query: string;
    results: Array<{
      content: string;
      score: number;
      source: string;
      service?: string;
      timestamp?: string;
      metadata: Record<string, unknown>;
    }>;
  }>;
}

interface KnowledgeGraphAnalysis {
  graph_summary?: Record<string, unknown>;
  dependency_traversal?: unknown[];
  impact_analysis?: Array<{
    failed_node: string;
    critical_services_at_risk: string[];
    summary: {
      total_impacted: number;
      services_impacted: number;
    };
  }>;
}

interface UserFeedback {
  incident_id: string;
  root_cause_confirmed?: boolean;
  corrected_root_cause?: string;
  corrected_services?: string[];
  notes?: string;
}

const PHASE2_DIR = path.resolve("data/synthetic/phase2");
const PHASE3_DIR = path.resolve("data/synthetic/phase3");
const PHASE3_SCRIPT_DIR = path.resolve("scripts/phase3");

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

function writeJsonFile(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toSentenceCase(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function extractStructuredTimeline(investigation: Phase2Investigation): Array<{
  time: string;
  label: string;
  source: string;
}> {
  const events = investigation.timeline?.events || [];
  return events
    .filter((event) => event.timestamp)
    .slice(0, 12)
    .map((event) => ({
      time: event.timestamp,
      label: `${toSentenceCase(event.service)}: ${event.event}`,
      source: event.type,
    }));
}

function inferTimelineMilestones(investigation: Phase2Investigation): Array<{
  time: string;
  label: string;
  source: string;
}> {
  const events = investigation.timeline?.events || [];
  const firstDeployment = events.find((event) => event.type === "deployment" && event.severity === "CRITICAL");
  const firstError = events.find((event) => event.type === "log" && event.severity === "ERROR");
  const firstTicket = events.find((event) => event.type === "ticket");

  return [
    firstDeployment ? { time: firstDeployment.timestamp, label: firstDeployment.event, source: "deployment" } : null,
    firstError ? { time: firstError.timestamp, label: firstError.event, source: "log" } : null,
    firstTicket ? { time: firstTicket.timestamp, label: firstTicket.event, source: "ticket" } : null,
  ].filter(Boolean) as Array<{ time: string; label: string; source: string }>;
}

function collectAffectedServices(investigation: Phase2Investigation): string[] {
  const graphServices = Object.values(investigation.graph_analysis?.blast_radius || {}).flat();
  const hypothesisServices = investigation.hypotheses?.hypotheses.flatMap((item) => item.affected_services) || [];
  const plannedServices = investigation.plan?.key_services || [];

  return [...new Set([...plannedServices, ...graphServices, ...hypothesisServices])].filter(Boolean);
}

function buildEvidenceMap(
  investigation: Phase2Investigation,
  hybrid: HybridResultSet,
  graph: KnowledgeGraphAnalysis,
): Array<{ claim: string; citations: EvidenceCitation[] }> {
  const logClusterCitations: EvidenceCitation[] = (investigation.log_analysis?.clusters || []).slice(0, 3).map((cluster) => ({
    source: "logs",
    reference: cluster.pattern,
    snippet: cluster.sample_messages[0] || cluster.pattern,
    relevance: "high",
  }));

  const deploymentEvidence = (investigation.timeline?.events || [])
    .filter((event) => event.type === "deployment" && event.severity === "CRITICAL")
    .slice(0, 3)
    .map((event) => ({
      source: "deployment_history",
      reference: event.timestamp,
      snippet: event.event,
      relevance: "high" as const,
    }));

  const graphEvidence = (graph.impact_analysis || []).slice(0, 2).map((impact) => ({
    source: "dependency_graph",
    reference: impact.failed_node,
    snippet: `${impact.failed_node} impacts ${impact.critical_services_at_risk.join(", ")}`,
    relevance: "medium" as const,
  }));

  const retrievalEvidence = (hybrid.query_results || []).slice(0, 2).flatMap((query) =>
    query.results.slice(0, 2).map((result) => ({
      source: result.source,
      reference: query.query,
      snippet: result.content,
      relevance: "medium" as const,
    })),
  );

  return [
    {
      claim: investigation.critique?.final_root_cause || "Root cause hypothesis",
      citations: [...deploymentEvidence, ...logClusterCitations].slice(0, 5),
    },
    {
      claim: "Cascading service impact",
      citations: [...graphEvidence, ...retrievalEvidence].slice(0, 5),
    },
    {
      claim: investigation.conflict_analysis?.summary || "Conflict analysis",
      citations: (investigation.conflict_analysis?.conflicts || []).slice(0, 3).map((conflict) => ({
        source: conflict.evidence_source,
        reference: conflict.ticket_id,
        snippet: `${conflict.ticket_claim} -> ${conflict.contradiction}`,
        relevance: "medium" as const,
      })),
    },
  ];
}

function calibrateConfidence(
  investigation: Phase2Investigation,
  feedback: UserFeedback | null,
): {
  score: number;
  factors: Array<{ name: string; value: number; reason: string }>;
} {
  const factors: Array<{ name: string; value: number; reason: string }> = [];
  const confirmedCount = investigation.critique?.verified_hypotheses.filter((item) => item.verdict === "confirmed").length || 0;
  const plausibleCount = investigation.critique?.verified_hypotheses.filter((item) => item.verdict === "plausible").length || 0;
  const breakingDeployments = (investigation.timeline?.events || []).filter(
    (event) => event.type === "deployment" && event.event.includes("[BREAKING]"),
  ).length;
  const errorDensity = (investigation.log_analysis?.error_count || 0) / Math.max(investigation.log_analysis?.total_logs_analyzed || 1, 1);
  const impactedServices = Object.values(investigation.graph_analysis?.blast_radius || {}).flat().length;
  const conflictPenalty = investigation.conflict_analysis?.conflicts.length || 0;

  factors.push({
    name: "critic_verdicts",
    value: confirmedCount > 0 ? 0.28 : plausibleCount > 0 ? 0.18 : 0.08,
    reason: `${confirmedCount} confirmed and ${plausibleCount} plausible hypotheses`,
  });
  factors.push({
    name: "deployment_proximity",
    value: breakingDeployments > 0 ? 0.2 : 0.05,
    reason: `${breakingDeployments} breaking deployments found before the failure window`,
  });
  factors.push({
    name: "log_signal_strength",
    value: clamp(errorDensity, 0, 0.22),
    reason: `${investigation.log_analysis?.error_count || 0} error logs across ${(investigation.log_analysis?.total_logs_analyzed || 0)} analyzed logs`,
  });
  factors.push({
    name: "dependency_impact",
    value: impactedServices > 0 ? 0.16 : 0.04,
    reason: `${impactedServices} impacted downstream services inferred from the graph`,
  });
  factors.push({
    name: "user_feedback",
    value: feedback?.root_cause_confirmed ? 0.12 : feedback?.corrected_root_cause ? -0.08 : 0,
    reason: feedback?.root_cause_confirmed
      ? "User confirmed the inferred root cause"
      : feedback?.corrected_root_cause
        ? "User supplied a corrected root cause"
        : "No feedback yet",
  });
  factors.push({
    name: "conflict_penalty",
    value: Math.max(-0.12, -0.02 * conflictPenalty),
    reason: `${conflictPenalty} conflicting ticket assumptions detected against logs/deployments`,
  });

  const score = clamp(factors.reduce((sum, factor) => sum + factor.value, 0.22), 0.05, 0.98);
  return { score: Number(score.toFixed(2)), factors };
}

function updateIncidentMemory(
  investigation: Phase2Investigation,
  confidence: { score: number; factors: Array<{ name: string; value: number; reason: string }> },
  affectedServices: string[],
): Record<string, unknown> {
  const memoryPath = path.join(PHASE3_DIR, "incident_memory.json");
  const existing = fs.existsSync(memoryPath)
    ? readJsonFile<{ incidents: Array<Record<string, unknown>>; recurring_patterns: string[] }>(memoryPath)
    : { incidents: [], recurring_patterns: [] };

  const recurringPatterns = new Set(existing.recurring_patterns);
  for (const cluster of investigation.log_analysis?.clusters || []) {
    recurringPatterns.add(cluster.pattern);
  }

  const newIncident = {
    incident_id: `incident-${new Date(investigation.generated_at).toISOString()}`,
    recorded_at: new Date().toISOString(),
    summary: investigation.plan?.incident_summary,
    root_cause: investigation.critique?.final_root_cause,
    affected_services: affectedServices,
    confidence_score: confidence.score,
  };

  const memory = {
    incidents: [...existing.incidents, newIncident].slice(-20),
    recurring_patterns: [...recurringPatterns].slice(0, 50),
  };
  writeJsonFile(memoryPath, memory);
  return memory;
}

function loadFeedbackTemplate(): UserFeedback | null {
  const feedbackPath = path.join(PHASE3_DIR, "user_feedback.json");
  if (!fs.existsSync(feedbackPath)) {
    writeJsonFile(feedbackPath, {
      incident_id: "incident-latest",
      root_cause_confirmed: null,
      corrected_root_cause: "",
      corrected_services: [],
      notes: "",
    });
    return null;
  }

  const feedback = readJsonFile<UserFeedback>(feedbackPath);
  return feedback.root_cause_confirmed === undefined && !feedback.corrected_root_cause && !feedback.notes
    ? null
    : feedback;
}

function buildStreamingInsights(investigation: Phase2Investigation, calibratedScore: number): Array<{ step: number; stage: string; message: string }> {
  return [
    {
      step: 1,
      stage: "retrieval",
      message: `Loaded incident context for \"${investigation.plan?.incident_summary}\" and aligned evidence from logs, tickets, deployments, and graph outputs.`,
    },
    {
      step: 2,
      stage: "timeline",
      message: `Identified incident window ${investigation.timeline?.incident_start || "unknown"} to ${investigation.timeline?.incident_peak || "unknown"}.`,
    },
    {
      step: 3,
      stage: "root-cause",
      message: `Most likely root cause: ${investigation.critique?.final_root_cause || investigation.hypotheses?.most_likely || "unknown"}.`,
    },
    {
      step: 4,
      stage: "confidence",
      message: `Calibrated confidence score computed at ${calibratedScore.toFixed(2)} using evidence corroboration, deployment signals, graph impact, and user feedback.`,
    },
  ];
}

function buildRecommendedActions(investigation: Phase2Investigation): string[] {
  const rootCause = (investigation.critique?.final_root_cause || "").toLowerCase();
  const actions = [
    "Roll back or disable the suspected breaking deployment before wider recovery actions.",
    "Add targeted regression tests around token parsing and authentication edge cases.",
    "Strengthen dependency monitoring for auth, orders, and payments to catch cascade onset earlier.",
  ];

  if (rootCause.includes("token validation")) {
    actions.unshift("Validate JWT parsing and token validation changes in a canary environment before redeployment.");
  }

  return [...new Set(actions)];
}

function buildFinalStructuredReport(
  investigation: Phase2Investigation,
  evidenceMap: Array<{ claim: string; citations: EvidenceCitation[] }>,
  confidence: { score: number; factors: Array<{ name: string; value: number; reason: string }> },
  affectedServices: string[],
): Record<string, unknown> {
  const timeline = extractStructuredTimeline(investigation).map((item) => ({
    time: item.time,
    event: item.label,
    source: item.source,
  }));
  const inferredTimeline = inferTimelineMilestones(investigation).map((item) => ({
    time: item.time,
    event: item.label,
    source: item.source,
  }));

  return {
    root_cause_analysis: investigation.resolution?.selected_root_cause || investigation.critique?.final_root_cause || investigation.hypotheses?.most_likely,
    timeline_of_events: timeline.length > 0 ? timeline : inferredTimeline,
    affected_services: affectedServices,
    supporting_evidence: evidenceMap,
    confidence_score: investigation.resolution?.confidence_score || confidence.score,
    recommended_actions: buildRecommendedActions(investigation),
  };
}

function buildMarkdownReport(
  structuredReport: Record<string, unknown>,
  confidence: { score: number; factors: Array<{ name: string; value: number; reason: string }> },
): string {
  const timeline = ((structuredReport.timeline_of_events as Array<{ time: string; event: string }>) || [])
    .map((item) => `- ${item.time} — ${item.event}`)
    .join("\n");
  const services = ((structuredReport.affected_services as string[]) || []).map((item) => `- ${item}`).join("\n");
  const evidence = ((structuredReport.supporting_evidence as Array<{ claim: string; citations: EvidenceCitation[] }>) || [])
    .map((entry) => {
      const citations = entry.citations.map((citation) => `  - [${citation.source}] ${citation.reference}: ${citation.snippet}`).join("\n");
      return `- ${entry.claim}\n${citations}`;
    })
    .join("\n");
  const recommendations = ((structuredReport.recommended_actions as string[]) || [])
    .map((item, index) => `${index + 1}. ${item}`)
    .join("\n");
  const factors = confidence.factors.map((factor) => `- ${factor.name}: ${factor.reason}`).join("\n");

  return `# Phase 3 Incident Investigation Report

## Root Cause Analysis

${structuredReport.root_cause_analysis as string}

## Timeline of Events

${timeline}

## Affected Services

${services}

## Supporting Evidence / Citations

${evidence}

## Confidence Score

${confidence.score}

Calibration signals:
${factors}

## Recommended Actions

${recommendations}
`;
}

function buildDashboardHtml(
  structuredReport: Record<string, unknown>,
  streamingInsights: Array<{ step: number; stage: string; message: string }>,
): string {
  const reportJson = JSON.stringify(structuredReport);
  const streamJson = JSON.stringify(streamingInsights);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Phase 3 Incident Dashboard</title>
  <style>
    :root {
      --bg: #f5f1e8;
      --panel: #fffdf8;
      --ink: #1e1a16;
      --accent: #a63d40;
      --muted: #6c6257;
      --line: #d9cfc3;
    }
    body {
      margin: 0;
      font-family: Georgia, "Iowan Old Style", serif;
      background: radial-gradient(circle at top left, #fff8ef, var(--bg));
      color: var(--ink);
    }
    .wrap {
      max-width: 1180px;
      margin: 0 auto;
      padding: 32px 20px 64px;
    }
    h1, h2 { margin: 0 0 12px; }
    .hero {
      display: grid;
      gap: 18px;
      grid-template-columns: 1.2fr 0.8fr;
      margin-bottom: 24px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 20px;
      box-shadow: 0 12px 30px rgba(0,0,0,0.06);
    }
    .metric {
      font-size: 2.4rem;
      color: var(--accent);
    }
    .grid {
      display: grid;
      gap: 18px;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    }
    ul { padding-left: 20px; margin: 0; }
    .stream { display: grid; gap: 10px; }
    .stream-item {
      padding: 12px 14px;
      border-left: 4px solid var(--accent);
      background: #fff6f2;
      border-radius: 10px;
    }
    .muted { color: var(--muted); }
    @media (max-width: 820px) {
      .hero { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hero">
      <section class="card">
        <p class="muted">Phase 3 Advanced Features</p>
        <h1>Incident Investigation Dashboard</h1>
        <p id="rootCause"></p>
      </section>
      <section class="card">
        <p class="muted">Confidence</p>
        <div class="metric" id="confidence"></div>
      </section>
    </div>
    <div class="grid">
      <section class="card">
        <h2>Timeline</h2>
        <ul id="timeline"></ul>
      </section>
      <section class="card">
        <h2>Affected Services</h2>
        <ul id="services"></ul>
      </section>
      <section class="card">
        <h2>Recommended Actions</h2>
        <ul id="actions"></ul>
      </section>
      <section class="card">
        <h2>Streaming Insights</h2>
        <div id="stream" class="stream"></div>
      </section>
    </div>
  </div>
  <script>
    const report = ${reportJson};
    const stream = ${streamJson};
    document.getElementById("rootCause").textContent = report.root_cause_analysis;
    document.getElementById("confidence").textContent = report.confidence_score;
    for (const item of report.timeline_of_events) {
      const li = document.createElement("li");
      li.textContent = item.time + " - " + item.event;
      document.getElementById("timeline").appendChild(li);
    }
    for (const item of report.affected_services) {
      const li = document.createElement("li");
      li.textContent = item;
      document.getElementById("services").appendChild(li);
    }
    for (const item of report.recommended_actions) {
      const li = document.createElement("li");
      li.textContent = item;
      document.getElementById("actions").appendChild(li);
    }
    for (const item of stream) {
      const div = document.createElement("div");
      div.className = "stream-item";
      div.textContent = String(item.step) + ". " + item.message;
      document.getElementById("stream").appendChild(div);
    }
  </script>
</body>
</html>`;
}

async function main(): Promise<void> {
  ensureDir(PHASE3_DIR);
  ensureDir(PHASE3_SCRIPT_DIR);

  const investigation = readJsonFile<Phase2Investigation>(path.join(PHASE2_DIR, "multi_agent_investigation.json"));
  const hybrid = readJsonFile<HybridResultSet>(path.join(PHASE2_DIR, "hybrid_rag_results.json"));
  const graph = readJsonFile<KnowledgeGraphAnalysis>(path.join(PHASE2_DIR, "knowledge_graph_analysis.json"));
  const feedback = loadFeedbackTemplate();

  const affectedServices = collectAffectedServices(investigation);
  const confidence = calibrateConfidence(investigation, feedback);
  const evidenceMap = buildEvidenceMap(investigation, hybrid, graph);
  const incidentMemory = updateIncidentMemory(investigation, confidence, affectedServices);
  const streamingInsights = buildStreamingInsights(investigation, confidence.score);
  const structuredReport = buildFinalStructuredReport(investigation, evidenceMap, confidence, affectedServices);
  const markdownReport = buildMarkdownReport(structuredReport, confidence);
  const dashboardHtml = buildDashboardHtml(structuredReport, streamingInsights);

  writeJsonFile(path.join(PHASE3_DIR, "streaming_insights.json"), streamingInsights);
  writeJsonFile(path.join(PHASE3_DIR, "explainability_trace.json"), evidenceMap);
  writeJsonFile(path.join(PHASE3_DIR, "confidence_calibration.json"), confidence);
  writeJsonFile(path.join(PHASE3_DIR, "incident_memory.json"), incidentMemory);
  writeJsonFile(path.join(PHASE3_DIR, "final_incident_report.json"), structuredReport);
  fs.writeFileSync(path.join(PHASE3_DIR, "final_incident_report.md"), markdownReport);
  fs.writeFileSync(path.join(PHASE3_DIR, "dashboard.html"), dashboardHtml);

  console.log("Phase 3 Advanced Features Integration");
  console.log("============================================================");
  console.log(`Confidence Score: ${confidence.score}`);
  console.log(`Affected Services: ${affectedServices.join(", ")}`);
  console.log(`Root Cause: ${structuredReport.root_cause_analysis as string}`);
  console.log("Outputs written to data/synthetic/phase3/");
}

main().catch((error) => {
  console.error("Phase 3 generation failed:", error);
  process.exit(1);
});