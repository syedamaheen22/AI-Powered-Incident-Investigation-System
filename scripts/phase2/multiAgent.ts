import fs from "fs";
import path from "path";
import { ChatOllama } from "@langchain/ollama";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════

const MODEL = "llama3";
const OLLAMA_BASE_URL = "http://localhost:11434";
const PHASE1_DIR = path.resolve("data/synthetic/phase1");
const PHASE2_OUTPUT_DIR = path.resolve("data/synthetic/phase2");

const llm = new ChatOllama({ model: MODEL, baseUrl: OLLAMA_BASE_URL, temperature: 0.2 });
const parser = new StringOutputParser();

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface LogEntry {
  timestamp?: string;
  ts?: string;
  service?: string;
  svc?: string;
  level?: string;
  lvl?: string;
  message?: string;
  msg?: string;
  request_id?: string;
  reqId?: string;
  [key: string]: any;
}

interface Ticket {
  ticket_id: string;
  title: string;
  description: string;
  service: string;
  timestamp: string;
  resolution?: string;
}

interface Deployment {
  service: string;
  version: string;
  timestamp: string;
  change_description: string;
  is_breaking_change?: boolean;
}

interface KGNode {
  id: string;
  type: string;
  owner: string;
  region: string;
  description: string;
}

interface KGEdge {
  source: string;
  target: string;
  relationship: string;
}

// ─── Agent context passed between agents ────────────────────────────────
interface InvestigationContext {
  user_query: string;
  plan?: PlannerOutput;
  log_analysis?: LogAnalysisOutput;
  timeline?: TimelineOutput;
  graph_analysis?: GraphOutput;
  hypotheses?: HypothesisOutput;
  critique?: CritiqueOutput;
  conflict_analysis?: ConflictAnalysisOutput;
  resolution?: RootCauseResolution;
  report?: string;
}

interface PlannerOutput {
  incident_summary: string;
  investigation_steps: string[];
  key_services: string[];
  time_window: string;
}

interface LogCluster {
  pattern: string;
  services: string[];
  count: number;
  severity: string;
  sample_messages: string[];
}

interface LogAnalysisOutput {
  total_logs_analyzed: number;
  error_count: number;
  anomaly_window: string;
  top_errors: string[];
  clusters: LogCluster[];
  llm_summary: string;
}

interface TimelineEvent {
  timestamp: string;
  type: "log" | "deployment" | "ticket";
  service: string;
  event: string;
  severity?: string;
}

interface TimelineOutput {
  events: TimelineEvent[];
  narrative: string;
  incident_start: string;
  incident_peak: string;
}

interface GraphOutput {
  failed_services: string[];
  blast_radius: Record<string, string[]>;
  dependency_chains: Array<{ from: string; to: string; path: string[] }>;
  llm_summary: string;
}

interface Hypothesis {
  id: string;
  root_cause: string;
  evidence: string[];
  confidence: "high" | "medium" | "low";
  affected_services: string[];
}

interface HypothesisOutput {
  hypotheses: Hypothesis[];
  most_likely: string;
}

interface CritiqueOutput {
  verified_hypotheses: Array<{
    hypothesis_id: string;
    verdict: "confirmed" | "plausible" | "rejected";
    reasoning: string;
    supporting_evidence: string[];
    contradicting_evidence: string[];
  }>;
  final_root_cause: string;
}

interface ConflictAnalysisOutput {
  conflicts: Array<{
    ticket_id: string;
    ticket_claim: string;
    contradiction: string;
    evidence_source: string;
  }>;
  summary: string;
}

interface RootCauseResolution {
  selected_root_cause: string;
  supporting_evidence: string[];
  confidence_score: number;
  top_candidate_service: string;
}

const SERVICE_ALIASES: Record<string, string> = {
  auth: "auth-service",
  authentication: "auth-service",
  "auth-service": "auth-service",
  orders: "orders-service",
  order: "orders-service",
  "orders-service": "orders-service",
  payments: "payments-service",
  payment: "payments-service",
  "payments-service": "payments-service",
  gateway: "gateway-service",
  "gateway-service": "gateway-service",
  notifications: "notifications-service",
  notification: "notifications-service",
  "notifications-service": "notifications-service",
};

function normalizeServiceId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");

  if (SERVICE_ALIASES[normalized]) {
    return SERVICE_ALIASES[normalized];
  }

  if (normalized.endsWith("-service")) {
    return normalized;
  }

  return SERVICE_ALIASES[normalized.replace(/-service$/, "")] || normalized;
}

function normalizeServiceList(values: string[]): string[] {
  return [...new Set(values.map(normalizeServiceId).filter(Boolean))];
}

function getLogTimestamp(log: LogEntry): string {
  return log.timestamp || log.ts || "";
}

function getLogService(log: LogEntry): string {
  return normalizeServiceId(log.service || log.svc || "unknown");
}

function getLogMessage(log: LogEntry): string {
  return log.message || log.msg || "";
}

function keywordMatches(text: string, keywords: string[]): boolean {
  const value = text.toLowerCase();
  return keywords.some((keyword) => value.includes(keyword));
}

// ═══════════════════════════════════════════════════════════════════════════
// DATA LOADERS
// ═══════════════════════════════════════════════════════════════════════════

function loadLogs(): LogEntry[] {
  return JSON.parse(fs.readFileSync(path.join(PHASE1_DIR, "logs_step1.json"), "utf-8"));
}

function loadTickets(): Ticket[] {
  return JSON.parse(fs.readFileSync(path.join(PHASE1_DIR, "tickets_step2.json"), "utf-8"));
}

function loadDeployments(): Deployment[] {
  return JSON.parse(fs.readFileSync(path.join(PHASE1_DIR, "deployments_step4.json"), "utf-8"));
}

function loadKnowledgeGraph(): { nodes: KGNode[]; edges: KGEdge[] } {
  return JSON.parse(
    fs.readFileSync(path.join(PHASE1_DIR, "knowledge_graph_step5.json"), "utf-8"),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// AGENT 1: PLANNER AGENT
// ═══════════════════════════════════════════════════════════════════════════

const PlannerSchema = z.object({
  incident_summary: z.string(),
  investigation_steps: z.array(z.string()),
  key_services: z.array(z.string()),
  time_window: z.string(),
});

async function runPlannerAgent(userQuery: string): Promise<PlannerOutput> {
  console.log("\n[Planner Agent] Breaking down investigation query...");

  const structuredLlm = llm.withStructuredOutput(PlannerSchema);
  const result = await structuredLlm.invoke([
    new SystemMessage(
      `You are an incident investigation planner. Given a user query about a production incident, 
      produce a structured investigation plan. Extract the core incident, list specific investigation 
      steps, identify relevant services, and define the time window to investigate.`,
    ),
    new HumanMessage(userQuery),
  ]);

  const normalizedResult: PlannerOutput = {
    incident_summary: result.incident_summary,
    investigation_steps: result.investigation_steps,
    key_services: normalizeServiceList(result.key_services),
    time_window: result.time_window,
  };

  console.log(`  ✓ Plan: ${normalizedResult.investigation_steps.length} steps, services: ${normalizedResult.key_services.join(", ")}`);
  return normalizedResult;
}

// ═══════════════════════════════════════════════════════════════════════════
// AGENT 2: LOG ANALYSIS AGENT
// ═══════════════════════════════════════════════════════════════════════════

function clusterLogs(logs: LogEntry[]): LogCluster[] {
  // Group error/warn logs by pattern matching on message
  const patternMap = new Map<string, { services: Set<string>; messages: string[]; severity: string }>();

  for (const log of logs) {
    const level = (log.level || log.lvl || "INFO").toUpperCase();
    if (!["ERROR", "WARN", "CRITICAL"].includes(level)) continue;

    const msg = log.message || log.msg || "";
    const service = log.service || log.svc || "unknown";

    // Extract pattern by removing variable parts (IDs, numbers, timestamps)
    const pattern = msg
      .replace(/\b[0-9a-f-]{8,}\b/gi, "<id>")
      .replace(/\d{4}-\d{2}-\d{2}T[\d:.Z]+/g, "<ts>")
      .replace(/\d+ms/g, "<duration>")
      .replace(/\d+\.\d+\.\d+\.\d+/g, "<ip>")
      .trim();

    if (!patternMap.has(pattern)) {
      patternMap.set(pattern, { services: new Set(), messages: [], severity: level });
    }
    const entry = patternMap.get(pattern)!;
    entry.services.add(service);
    if (entry.messages.length < 3) entry.messages.push(msg);
    if (level === "ERROR" || level === "CRITICAL") entry.severity = level;
  }

  return Array.from(patternMap.entries())
    .map(([pattern, data]) => ({
      pattern,
      services: Array.from(data.services),
      count: data.messages.length,
      severity: data.severity,
      sample_messages: data.messages,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

async function runLogAnalysisAgent(
  logs: LogEntry[],
  plan: PlannerOutput,
): Promise<LogAnalysisOutput> {
  console.log("\n[Log Analysis Agent] Analyzing logs for anomalies...");

  const errorLogs = logs.filter((l) => {
    const level = (l.level || l.lvl || "").toUpperCase();
    return level === "ERROR" || level === "CRITICAL";
  });

  const clusters = clusterLogs(logs);

  // Extract top errors
  const topErrors = errorLogs
    .slice(0, 20)
    .map((l) => `[${l.service || l.svc}] ${l.message || l.msg}`);

  // Find anomaly window (first ERROR timestamp to last)
  const errorTimestamps = errorLogs
    .map((l) => l.timestamp || l.ts || "")
    .filter(Boolean)
    .sort();
  const anomalyWindow =
    errorTimestamps.length > 0
      ? `${errorTimestamps[0]} → ${errorTimestamps[errorTimestamps.length - 1]}`
      : "unknown";

  // Ask LLM to summarize findings
  const clusterSummary = clusters
    .slice(0, 5)
    .map((c) => `Pattern: "${c.pattern}" | Services: ${c.services.join(",")} | Count: ${c.count}`)
    .join("\n");

  const llmSummary = await llm
    .pipe(parser)
    .invoke([
      new SystemMessage(
        "You are a log analysis expert. Summarize the error patterns found in a production incident in 3-4 sentences.",
      ),
      new HumanMessage(
        `Incident: ${plan.incident_summary}\n\nTop error clusters:\n${clusterSummary}\n\nTotal errors: ${errorLogs.length} out of ${logs.length} total logs.`,
      ),
    ]);

  console.log(`  ✓ Found ${errorLogs.length} errors, ${clusters.length} clusters`);

  return {
    total_logs_analyzed: logs.length,
    error_count: errorLogs.length,
    anomaly_window: anomalyWindow,
    top_errors: topErrors,
    clusters,
    llm_summary: llmSummary,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// AGENT 3: TIMELINE AGENT
// ═══════════════════════════════════════════════════════════════════════════

async function runTimelineAgent(
  logs: LogEntry[],
  deployments: Deployment[],
  tickets: Ticket[],
  plan: PlannerOutput,
): Promise<TimelineOutput> {
  console.log("\n[Timeline Agent] Building chronological event timeline...");

  const events: TimelineEvent[] = [];

  // Add ERROR/CRITICAL log events
  for (const log of logs) {
    const level = (log.level || log.lvl || "").toUpperCase();
    const timestamp = getLogTimestamp(log);
    if (["ERROR", "CRITICAL", "WARN"].includes(level) && timestamp) {
      events.push({
        timestamp,
        type: "log",
        service: getLogService(log),
        event: getLogMessage(log),
        severity: level,
      });
    }
  }

  // Add deployments
  for (const dep of deployments) {
    events.push({
      timestamp: dep.timestamp,
      type: "deployment",
      service: dep.service,
      event: `Deployed ${dep.version}: ${dep.change_description}${dep.is_breaking_change ? " [BREAKING]" : ""}`,
      severity: dep.is_breaking_change ? "CRITICAL" : "INFO",
    });
  }

  // Add ticket creation events
  for (const ticket of tickets) {
    events.push({
      timestamp: ticket.timestamp,
      type: "ticket",
      service: ticket.service,
      event: `TICKET ${ticket.ticket_id}: ${ticket.title}`,
      severity: "WARN",
    });
  }

  // Sort chronologically
  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // Find incident start (first CRITICAL) and peak (highest density of errors)
  const criticalEvents = events.filter((e) => e.severity === "CRITICAL");
  const incidentStart = criticalEvents[0]?.timestamp || events[0]?.timestamp || "unknown";
  const incidentPeak =
    criticalEvents[Math.floor(criticalEvents.length / 2)]?.timestamp || incidentStart;

  // Build condensed timeline for LLM (top 30 events around incident window)
  const keyEvents = events
    .filter((e) => e.severity === "CRITICAL" || e.type === "deployment")
    .slice(0, 30)
    .map((e) => `[${e.timestamp}] [${e.type.toUpperCase()}] [${e.service}] ${e.event}`)
    .join("\n");

  const narrative = await llm
    .pipe(parser)
    .invoke([
      new SystemMessage(
        "You are a timeline analyst. Narrate the sequence of events leading to a production incident in chronological order. Be concise — 5-8 sentences.",
      ),
      new HumanMessage(
        `Incident: ${plan.incident_summary}\n\nKey Events:\n${keyEvents}`,
      ),
    ]);

  console.log(`  ✓ Built timeline with ${events.length} events`);

  return {
    events: events.slice(0, 50), // cap output size
    narrative,
    incident_start: incidentStart,
    incident_peak: incidentPeak,
  };
}

function runConflictAnalysis(
  tickets: Ticket[],
  logs: LogEntry[],
  deployments: Deployment[],
): ConflictAnalysisOutput {
  const conflicts: ConflictAnalysisOutput["conflicts"] = [];
  const logCorpus = logs.map((log) => getLogMessage(log).toLowerCase()).join(" \n ");
  const deploymentCorpus = deployments.map((dep) => dep.change_description.toLowerCase()).join(" \n ");

  for (const ticket of tickets.slice(0, 40)) {
    const claim = ticket.description.toLowerCase();

    if (keywordMatches(claim, ["database", "db"]) && keywordMatches(logCorpus, ["token", "auth", "jwt"])) {
      conflicts.push({
        ticket_id: ticket.ticket_id,
        ticket_claim: ticket.title,
        contradiction: "Ticket leans toward a database cause while logs are dominated by auth/token failures.",
        evidence_source: "logs",
      });
    }

    if (keywordMatches(claim, ["frontend", "ui", "browser"]) && keywordMatches(logCorpus, ["gateway", "payments", "auth"])) {
      conflicts.push({
        ticket_id: ticket.ticket_id,
        ticket_claim: ticket.title,
        contradiction: "Ticket blames the frontend but backend dependency failures are present in logs.",
        evidence_source: "logs",
      });
    }

    if (keywordMatches(claim, ["infrastructure", "network"]) && keywordMatches(deploymentCorpus, ["breaking", "refactored", "validation", "upgrade"])) {
      conflicts.push({
        ticket_id: ticket.ticket_id,
        ticket_claim: ticket.title,
        contradiction: "Ticket blames infrastructure while deployment history shows likely breaking application changes.",
        evidence_source: "deployments",
      });
    }
  }

  return {
    conflicts: conflicts.slice(0, 12),
    summary:
      conflicts.length > 0
        ? `Detected ${Math.min(conflicts.length, 12)} ticket-to-evidence conflicts where user assumptions diverge from logs or deployments.`
        : "No major ticket-to-evidence conflicts detected.",
  };
}

function resolveRootCause(
  deployments: Deployment[],
  ctx: InvestigationContext,
): RootCauseResolution {
  const anomalyStart = ctx.log_analysis?.anomaly_window.split(" → ")[0] || "2026-04-10T14:00:00Z";
  const anomalyMs = new Date(anomalyStart).getTime();
  const logText = (ctx.log_analysis?.clusters || [])
    .map((cluster) => `${cluster.pattern} ${cluster.services.join(" ")}`.toLowerCase())
    .join(" \n ");
  const graphServices = new Set(ctx.graph_analysis?.failed_services || []);
  const plannedServices = new Set(ctx.plan?.key_services || []);

  const ranked = deployments
    .map((deployment) => {
      let score = 0;
      const service = normalizeServiceId(deployment.service);
      const depMs = new Date(deployment.timestamp).getTime();
      const minutesBeforeIncident = Number.isFinite(depMs) ? Math.abs(anomalyMs - depMs) / 60000 : 999;
      const description = deployment.change_description.toLowerCase();

      if (deployment.is_breaking_change) score += 3;
      if (plannedServices.has(service)) score += 2;
      if (graphServices.has(service)) score += 2;
      if (minutesBeforeIncident <= 90) score += 2;
      if (minutesBeforeIncident <= 30) score += 1;
      if (keywordMatches(description, ["token", "jwt", "validation", "auth"]) && keywordMatches(logText, ["token", "auth", "jwt"])) score += 3;
      if (keywordMatches(description, ["payments", "gateway"]) && keywordMatches(logText, ["payments", "gateway"])) score += 1.5;
      if (keywordMatches(description, ["rollback", "hotfix"])) score -= 1;

      return { deployment, service, score };
    })
    .sort((a, b) => b.score - a.score);

  const top = ranked[0];
  const selectedRootCause = top
    ? `${top.deployment.service} ${top.deployment.version}: ${top.deployment.change_description}`
    : ctx.critique?.final_root_cause || ctx.hypotheses?.most_likely || "No root cause resolved";

  return {
    selected_root_cause: selectedRootCause,
    supporting_evidence: [
      `Anomaly window begins at ${anomalyStart}`,
      `Top log patterns: ${(ctx.log_analysis?.clusters || []).slice(0, 3).map((cluster) => cluster.pattern).join("; ")}`,
      `Affected services from graph: ${(ctx.graph_analysis?.failed_services || []).join(", ")}`,
      `Conflict summary: ${ctx.conflict_analysis?.summary || "none"}`,
    ],
    confidence_score: Number(Math.min(0.95, 0.45 + ((top?.score || 0) / 12)).toFixed(2)),
    top_candidate_service: top?.service || "unknown",
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// AGENT 4: GRAPH AGENT
// ═══════════════════════════════════════════════════════════════════════════

function buildAdjacency(edges: KGEdge[]): {
  inEdges: Map<string, string[]>;
  outEdges: Map<string, string[]>;
} {
  const inEdges = new Map<string, string[]>();
  const outEdges = new Map<string, string[]>();

  for (const edge of edges) {
    if (!outEdges.has(edge.source)) outEdges.set(edge.source, []);
    if (!inEdges.has(edge.target)) inEdges.set(edge.target, []);
    outEdges.get(edge.source)!.push(edge.target);
    inEdges.get(edge.target)!.push(edge.source);
  }

  return { inEdges, outEdges };
}

function getBlastRadius(nodeId: string, inEdges: Map<string, string[]>): string[] {
  const visited = new Set<string>();
  const queue = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const callers = inEdges.get(current) || [];
    for (const caller of callers) {
      if (!visited.has(caller)) {
        visited.add(caller);
        queue.push(caller);
      }
    }
  }

  return Array.from(visited);
}

function shortestPath(
  from: string,
  to: string,
  outEdges: Map<string, string[]>,
): string[] | null {
  if (from === to) return [from];
  const queue: Array<string[]> = [[from]];
  const visited = new Set<string>([from]);

  while (queue.length > 0) {
    const path = queue.shift()!;
    const node = path[path.length - 1]!;
    for (const neighbor of outEdges.get(node) || []) {
      if (visited.has(neighbor)) continue;
      const newPath = [...path, neighbor];
      if (neighbor === to) return newPath;
      visited.add(neighbor);
      queue.push(newPath);
    }
  }
  return null;
}

async function runGraphAgent(
  kg: { nodes: KGNode[]; edges: KGEdge[] },
  plan: PlannerOutput,
  logAnalysis: LogAnalysisOutput,
): Promise<GraphOutput> {
  console.log("\n[Graph Agent] Analyzing service dependencies and blast radius...");

  const { inEdges, outEdges } = buildAdjacency(kg.edges);
  const validNodeIds = new Set(kg.nodes.map((n) => n.id));

  // Identify likely failed services from log clusters
  const failedServices = [
    ...new Set(
      logAnalysis.clusters
        .flatMap((c) => c.services)
        .map(normalizeServiceId)
        .filter((s) => validNodeIds.has(s)),
    ),
  ].slice(0, 3);

  const investigationServices = normalizeServiceList(plan.key_services).filter((svc) =>
    validNodeIds.has(svc),
  );

  // Blast radius per failed service
  const blastRadius: Record<string, string[]> = {};
  for (const service of failedServices) {
    blastRadius[service] = getBlastRadius(service, inEdges);
  }

  // Dependency chains from key services
  const depChains: Array<{ from: string; to: string; path: string[] }> = [];
  for (const svc of investigationServices) {
    for (const target of ["stripe-gateway", "user-db", "redis-cache"]) {
      const p = shortestPath(svc, target, outEdges);
      if (p) depChains.push({ from: svc, to: target, path: p });
    }
  }

  const blastSummary = Object.entries(blastRadius)
    .map(([svc, impacted]) => `${svc} → impacts: ${impacted.join(", ")}`)
    .join("\n");

  const llmSummary = await llm
    .pipe(parser)
    .invoke([
      new SystemMessage(
        "You are a service dependency expert. Explain which services were impacted and why, based on the dependency graph. Be concise — 3-5 sentences.",
      ),
      new HumanMessage(
        `Failed services: ${failedServices.join(", ")}\n\nBlast radius:\n${blastSummary}`,
      ),
    ]);

  console.log(`  ✓ Analyzed ${failedServices.length} failed services, ${Object.values(blastRadius).flat().length} total impacted nodes`);

  return {
    failed_services: failedServices,
    blast_radius: blastRadius,
    dependency_chains: depChains,
    llm_summary: llmSummary,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// AGENT 5: HYPOTHESIS AGENT
// ═══════════════════════════════════════════════════════════════════════════

const HypothesisListSchema = z.object({
  hypotheses: z.array(
    z.object({
      id: z.string(),
      root_cause: z.string(),
      evidence: z.array(z.string()),
      confidence: z.enum(["high", "medium", "low"]),
      affected_services: z.array(z.string()),
    }),
  ),
  most_likely: z.string(),
});

async function runHypothesisAgent(ctx: InvestigationContext): Promise<HypothesisOutput> {
  console.log("\n[Hypothesis Agent] Generating root cause hypotheses...");

  const structuredLlm = llm.withStructuredOutput(HypothesisListSchema);

  const evidence = [
    `Log anomaly window: ${ctx.log_analysis?.anomaly_window}`,
    `Log summary: ${ctx.log_analysis?.llm_summary}`,
    `Timeline narrative: ${ctx.timeline?.narrative}`,
    `Graph analysis: ${ctx.graph_analysis?.llm_summary}`,
    `Failed services: ${ctx.graph_analysis?.failed_services.join(", ")}`,
    `Key deployments: ${ctx.timeline?.events
      .filter((e) => e.type === "deployment" && e.severity === "CRITICAL")
      .slice(0, 5)
      .map((e) => e.event)
      .join("; ")}`,
  ].join("\n");

  const result = await structuredLlm.invoke([
    new SystemMessage(
      `You are a root cause analysis expert. Based on investigation findings, generate 3 distinct hypotheses 
      for the root cause of the incident. Each hypothesis must reference specific evidence. 
      Assign confidence levels and identify the most likely root cause.`,
    ),
    new HumanMessage(
      `Incident: ${ctx.user_query}\n\nInvestigation findings:\n${evidence}`,
    ),
  ]);

  console.log(`  ✓ Generated ${result.hypotheses.length} hypotheses, most likely: ${result.most_likely.substring(0, 60)}...`);
  return result as HypothesisOutput;
}

// ═══════════════════════════════════════════════════════════════════════════
// AGENT 6: CRITIC AGENT
// ═══════════════════════════════════════════════════════════════════════════

const CritiqueSchema = z.object({
  verified_hypotheses: z.array(
    z.object({
      hypothesis_id: z.string(),
      verdict: z.enum(["confirmed", "plausible", "rejected"]),
      reasoning: z.string(),
      supporting_evidence: z.array(z.string()),
      contradicting_evidence: z.array(z.string()),
    }),
  ),
  final_root_cause: z.string(),
});

async function runCriticAgent(
  ctx: InvestigationContext,
): Promise<CritiqueOutput> {
  console.log("\n[Critic Agent] Verifying hypotheses against evidence...");

  const structuredLlm = llm.withStructuredOutput(CritiqueSchema);

  const hypothesesText = ctx.hypotheses?.hypotheses
    .map(
      (h) =>
        `ID: ${h.id}\nRoot cause: ${h.root_cause}\nEvidence cited: ${h.evidence.join("; ")}\nConfidence: ${h.confidence}`,
    )
    .join("\n\n");

  const evidenceBank = [
    `Log clusters: ${ctx.log_analysis?.clusters
      .slice(0, 3)
      .map((c) => c.pattern)
      .join("; ")}`,
    `Timeline: ${ctx.timeline?.narrative}`,
    `Graph: ${ctx.graph_analysis?.llm_summary}`,
    `Conflicts: ${ctx.conflict_analysis?.summary}`,
    `Deployments with breaking changes: ${ctx.timeline?.events
      .filter((e) => e.type === "deployment" && e.severity === "CRITICAL")
      .map((e) => e.event)
      .join("; ")}`,
  ].join("\n");

  const result = await structuredLlm.invoke([
    new SystemMessage(
      `You are a critical reviewer for incident investigations. Your job is to verify each hypothesis 
      against concrete evidence from logs, deployments, and service dependencies. 
      Confirm, mark plausible, or reject each hypothesis with clear reasoning. 
      Then state the single most likely root cause.`,
    ),
    new HumanMessage(
      `Hypotheses to verify:\n${hypothesesText}\n\nEvidence bank:\n${evidenceBank}`,
    ),
  ]);

  console.log(`  ✓ Reviewed ${result.verified_hypotheses.length} hypotheses`);
  return result as CritiqueOutput;
}

// ═══════════════════════════════════════════════════════════════════════════
// AGENT 7: REPORT GENERATOR
// ═══════════════════════════════════════════════════════════════════════════

async function runReportGenerator(ctx: InvestigationContext): Promise<string> {
  console.log("\n[Report Generator] Producing final incident report...");

  const prompt = `
Generate a professional incident investigation report in Markdown format using the following findings.

## Input

**User Query:** ${ctx.user_query}

**Investigation Plan:**
- Steps: ${ctx.plan?.investigation_steps.join("; ")}
- Key Services: ${ctx.plan?.key_services.join(", ")}
- Time Window: ${ctx.plan?.time_window}

**Log Analysis:**
${ctx.log_analysis?.llm_summary}
- Errors: ${ctx.log_analysis?.error_count} / ${ctx.log_analysis?.total_logs_analyzed} logs
- Anomaly Window: ${ctx.log_analysis?.anomaly_window}

**Timeline:**
${ctx.timeline?.narrative}
- Incident Start: ${ctx.timeline?.incident_start}

**Graph Impact:**
${ctx.graph_analysis?.llm_summary}
- Failed Services: ${ctx.graph_analysis?.failed_services.join(", ")}

**Conflicting Information:**
${ctx.conflict_analysis?.summary}

**Root Cause (Verified):**
${ctx.resolution?.selected_root_cause || ctx.critique?.final_root_cause}

**Confidence Score:**
${ctx.resolution?.confidence_score ?? "unknown"}

**Hypothesis Verdicts:**
${ctx.critique?.verified_hypotheses
  .map((v) => `- [${v.verdict.toUpperCase()}] ${v.hypothesis_id}: ${v.reasoning}`)
  .join("\n")}

## Required Report Sections
1. Executive Summary
2. Incident Timeline
3. Affected Services
4. Root Cause Analysis
5. Evidence Summary
6. Recommendations
7. Next Steps
`;

  const report = await llm.pipe(parser).invoke([
    new SystemMessage(
      "You are a senior SRE writing a post-incident report. Write a clear, structured Markdown report.",
    ),
    new HumanMessage(prompt),
  ]);

  console.log("  ✓ Report generated");
  return report;
}

// ═══════════════════════════════════════════════════════════════════════════
// ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════

async function runInvestigation(userQuery: string): Promise<void> {
  console.log("Multi-Agent Incident Investigation System");
  console.log("=".repeat(60));
  console.log(`Query: ${userQuery}\n`);

  // Load Phase 1 data
  console.log("Loading Phase 1 data...");
  const logs = loadLogs();
  const tickets = loadTickets();
  const deployments = loadDeployments();
  const kg = loadKnowledgeGraph();
  console.log(`  ✓ Logs: ${logs.length}, Tickets: ${tickets.length}, Deployments: ${deployments.length}`);

  const ctx: InvestigationContext = { user_query: userQuery };

  // Agent 1: Planner
  ctx.plan = await runPlannerAgent(userQuery);

  // Agent 2: Log Analysis
  ctx.log_analysis = await runLogAnalysisAgent(logs, ctx.plan);

  // Agent 3: Timeline
  ctx.timeline = await runTimelineAgent(logs, deployments, tickets, ctx.plan);

  // Agent 4: Graph
  ctx.graph_analysis = await runGraphAgent(kg, ctx.plan, ctx.log_analysis);

  // Deterministic conflict analysis before hypothesis generation
  ctx.conflict_analysis = runConflictAnalysis(tickets, logs, deployments);

  // Agent 5: Hypothesis
  ctx.hypotheses = await runHypothesisAgent(ctx);

  // Agent 6: Critic
  ctx.critique = await runCriticAgent(ctx);

  // Deterministic evidence-backed resolution to improve faithfulness
  ctx.resolution = resolveRootCause(deployments, ctx);

  if (ctx.critique) {
    ctx.critique.final_root_cause = ctx.resolution.selected_root_cause;
  }

  // Agent 7: Report Generator
  ctx.report = await runReportGenerator(ctx);

  // ─── Save outputs ───────────────────────────────────────────────────
  if (!fs.existsSync(PHASE2_OUTPUT_DIR)) {
    fs.mkdirSync(PHASE2_OUTPUT_DIR, { recursive: true });
  }

  // Save full context as JSON
  const jsonOutput = {
    generated_at: new Date().toISOString(),
    user_query: userQuery,
    plan: ctx.plan,
    log_analysis: ctx.log_analysis,
    timeline: ctx.timeline,
    graph_analysis: ctx.graph_analysis,
    conflict_analysis: ctx.conflict_analysis,
    hypotheses: ctx.hypotheses,
    critique: ctx.critique,
    resolution: ctx.resolution,
  };

  fs.writeFileSync(
    path.join(PHASE2_OUTPUT_DIR, "multi_agent_investigation.json"),
    JSON.stringify(jsonOutput, null, 2),
  );

  // Save final report as Markdown
  fs.writeFileSync(
    path.join(PHASE2_OUTPUT_DIR, "incident_report.md"),
    ctx.report,
  );

  console.log("\n" + "=".repeat(60));
  console.log("INVESTIGATION COMPLETE");
  console.log("=".repeat(60));
  console.log(`✓ Full context → data/synthetic/phase2/multi_agent_investigation.json`);
  console.log(`✓ Incident report → data/synthetic/phase2/incident_report.md`);
  console.log("\n--- FINAL ROOT CAUSE ---");
  console.log(ctx.critique?.final_root_cause);
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

const QUERY =
  "At 14:00 UTC on 2026-04-10, users reported being unable to log in and orders were failing. " +
  "Auth-service errors spiked and cascading failures appeared across orders and payments. " +
  "Investigate the root cause and produce a full incident report.";

runInvestigation(QUERY).catch((err) => {
  console.error("Investigation failed:", err);
  process.exit(1);
});
