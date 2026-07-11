import fs from "fs";
import path from "path";

interface HybridResults {
  query_results: Array<{
    query: string;
    results: Array<{
      score: number;
      source: string;
      metadata?: { type?: string };
      content: string;
    }>;
  }>;
}

interface MultiAgentInvestigation {
  plan?: {
    investigation_steps: string[];
    key_services: string[];
  };
  log_analysis?: {
    total_logs_analyzed: number;
    error_count: number;
    clusters: Array<{ pattern: string; services: string[] }>;
  };
  timeline?: {
    events: Array<{ timestamp: string; type: string; service: string }>;
  };
  graph_analysis?: {
    failed_services: string[];
    blast_radius: Record<string, string[]>;
    dependency_chains: Array<{ from: string; to: string; path: string[] }>;
  };
  hypotheses?: {
    hypotheses: Array<{ id: string; evidence: string[]; affected_services: string[] }>;
  };
  critique?: {
    verified_hypotheses: Array<{
      verdict: "confirmed" | "plausible" | "rejected";
      supporting_evidence: string[];
      contradicting_evidence: string[];
    }>;
    final_root_cause: string;
  };
}

interface FinalReport {
  root_cause_analysis: string;
  timeline_of_events: Array<{ time: string; event: string; source: string }>;
  affected_services: string[];
  supporting_evidence: Array<{
    claim: string;
    citations: Array<{
      source: string;
      reference: string;
      snippet: string;
      relevance: "high" | "medium" | "low";
    }>;
  }>;
  confidence_score: number;
  recommended_actions: string[];
}

interface EvaluationDimension {
  name: string;
  score: number;
  verdict: "strong" | "acceptable" | "weak";
  rationale: string;
}

const PHASE2_DIR = path.resolve("data/synthetic/phase2");
const PHASE3_DIR = path.resolve("data/synthetic/phase3");

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function verdictFor(score: number): "strong" | "acceptable" | "weak" {
  if (score >= 0.8) return "strong";
  if (score >= 0.6) return "acceptable";
  return "weak";
}

function normalize(text: string): string {
  return text.toLowerCase();
}

function evaluateRetrievalQuality(hybrid: HybridResults): EvaluationDimension {
  const topResults = hybrid.query_results
    .map((query) => query.results[0])
    .filter(
      (
        item,
      ): item is {
        score: number;
        source: string;
        metadata?: { type?: string };
        content: string;
      } => Boolean(item),
    );
  const avgTopScore = topResults.reduce((sum, item) => sum + item.score, 0) / Math.max(topResults.length, 1);
  const sourceTypes = new Set(
    hybrid.query_results.flatMap((query) =>
      query.results.slice(0, 3).map((item) => item.metadata?.type || item.source),
    ),
  );
  const logLedQueries = hybrid.query_results.filter((query) => {
    const first = query.results[0];
    return first?.metadata?.type === "log" || first?.source === "logs_step1.json";
  }).length;

  let score = 0.45;
  score += Math.min(avgTopScore * 6, 0.25);
  score += Math.min(sourceTypes.size / 10, 0.15);
  score += (logLedQueries / Math.max(hybrid.query_results.length, 1)) * 0.15;
  score = clamp(score, 0, 1);

  return {
    name: "Retrieval Quality",
    score: Number(score.toFixed(2)),
    verdict: verdictFor(score),
    rationale: `Average top-result score is ${avgTopScore.toFixed(3)}, ${sourceTypes.size} source types appear in top results, and ${logLedQueries}/${hybrid.query_results.length} queries are led by logs.`,
  };
}

function evaluateFaithfulness(report: FinalReport, investigation: MultiAgentInvestigation): EvaluationDimension {
  const rootCause = normalize(report.root_cause_analysis || "");
  const citations = report.supporting_evidence.flatMap((item) => item.citations);
  const citationText = normalize(citations.map((item) => `${item.reference} ${item.snippet}`).join(" "));
  const contradictionCount =
    investigation.critique?.verified_hypotheses.reduce(
      (sum, item) => sum + item.contradicting_evidence.length,
      0,
    ) || 0;

  const mentionsPayments = rootCause.includes("payments-service") || rootCause.includes("payments");
  const mentionsAuth = rootCause.includes("auth-service") || rootCause.includes("auth");
  const paymentsEvidence = citationText.includes("payments-service") || citationText.includes("payment");
  const authEvidence = citationText.includes("auth-service") || citationText.includes("token validation");

  let score = 0.35;
  if ((mentionsPayments && paymentsEvidence) || (mentionsAuth && authEvidence)) score += 0.25;
  if (citations.length >= 4) score += 0.2;
  if (contradictionCount === 0) score += 0.1;
  if (mentionsPayments && authEvidence && !paymentsEvidence) score -= 0.15;
  score = clamp(score, 0, 1);

  return {
    name: "Faithfulness",
    score: Number(score.toFixed(2)),
    verdict: verdictFor(score),
    rationale: `Root cause is backed by ${citations.length} citations, but cross-checking evidence shows ${contradictionCount} contradicting evidence items and potential tension between auth-related and payments-related evidence.`,
  };
}

function evaluateReasoning(report: FinalReport, investigation: MultiAgentInvestigation): EvaluationDimension {
  const evidenceSources = new Set(report.supporting_evidence.flatMap((item) => item.citations.map((citation) => citation.source)));
  const dependencyChains = investigation.graph_analysis?.dependency_chains.length || 0;
  const hypothesisCount = investigation.hypotheses?.hypotheses.length || 0;

  let score = 0.4;
  score += Math.min(evidenceSources.size / 8, 0.2);
  score += Math.min(dependencyChains / 10, 0.2);
  score += Math.min(hypothesisCount / 5, 0.2);
  score = clamp(score, 0, 1);

  return {
    name: "Reasoning",
    score: Number(score.toFixed(2)),
    verdict: verdictFor(score),
    rationale: `${evidenceSources.size} evidence source categories, ${dependencyChains} dependency chains, and ${hypothesisCount} candidate hypotheses contribute to multi-source reasoning.`,
  };
}

function evaluateExplainability(report: FinalReport): EvaluationDimension {
  const citations = report.supporting_evidence.flatMap((item) => item.citations);
  const highRelevance = citations.filter((citation) => citation.relevance === "high").length;
  const score = clamp(0.35 + Math.min(citations.length / 10, 0.35) + Math.min(highRelevance / 8, 0.3), 0, 1);

  return {
    name: "Explainability",
    score: Number(score.toFixed(2)),
    verdict: verdictFor(score),
    rationale: `${citations.length} citations are included, with ${highRelevance} marked high relevance and claim-to-evidence mapping present in the explainability trace.`,
  };
}

function evaluateRobustness(investigation: MultiAgentInvestigation, report: FinalReport): EvaluationDimension {
  const totalLogs = investigation.log_analysis?.total_logs_analyzed || 0;
  const missingTimestamps = (investigation.timeline?.events || []).filter((item) => !item.timestamp).length;
  const servicesPresent = report.affected_services.length;

  let score = 0.45;
  if (totalLogs >= 500) score += 0.15;
  if (servicesPresent >= 3) score += 0.15;
  if (missingTimestamps > 0) score -= 0.15;
  if ((investigation.log_analysis?.clusters.length || 0) > 0) score += 0.1;
  score = clamp(score, 0, 1);

  return {
    name: "Robustness",
    score: Number(score.toFixed(2)),
    verdict: verdictFor(score),
    rationale: `The system handled ${totalLogs} logs and still produced outputs despite messy data, but ${missingTimestamps} timeline events are missing timestamps, which lowers robustness.`,
  };
}

function evaluateAgentCoordination(investigation: MultiAgentInvestigation): EvaluationDimension {
  const agentArtifacts = [
    investigation.plan,
    investigation.log_analysis,
    investigation.timeline,
    investigation.graph_analysis,
    investigation.hypotheses,
    investigation.critique,
  ].filter(Boolean).length;
  const graphUseful = (investigation.graph_analysis?.failed_services.length || 0) > 0;
  const score = clamp(0.35 + (agentArtifacts / 6) * 0.45 + (graphUseful ? 0.2 : 0), 0, 1);

  return {
    name: "Agent Coordination",
    score: Number(score.toFixed(2)),
    verdict: verdictFor(score),
    rationale: `${agentArtifacts}/6 core agent outputs were produced, and graph analysis ${graphUseful ? "did" : "did not"} contribute non-empty failed service results.`,
  };
}

function buildMarkdown(dimensions: EvaluationDimension[], overall: number): string {
  const lines = dimensions
    .map((item) => `- ${item.name}: ${item.score.toFixed(2)} (${item.verdict})\n  ${item.rationale}`)
    .join("\n");

  return `# Phase 3 Evaluation Report

Overall score: ${overall.toFixed(2)}

## Dimension Scores

${lines}
`;
}

async function main(): Promise<void> {
  const hybrid = readJson<HybridResults>(path.join(PHASE2_DIR, "hybrid_rag_results.json"));
  const investigation = readJson<MultiAgentInvestigation>(path.join(PHASE2_DIR, "multi_agent_investigation.json"));
  const report = readJson<FinalReport>(path.join(PHASE3_DIR, "final_incident_report.json"));

  const dimensions = [
    evaluateRetrievalQuality(hybrid),
    evaluateFaithfulness(report, investigation),
    evaluateReasoning(report, investigation),
    evaluateExplainability(report),
    evaluateRobustness(investigation, report),
    evaluateAgentCoordination(investigation),
  ];

  const overall = dimensions.reduce((sum, item) => sum + item.score, 0) / dimensions.length;
  const output = {
    generated_at: new Date().toISOString(),
    overall_score: Number(overall.toFixed(2)),
    dimensions,
  };

  fs.writeFileSync(path.join(PHASE3_DIR, "evaluation_report.json"), JSON.stringify(output, null, 2));
  fs.writeFileSync(path.join(PHASE3_DIR, "evaluation_report.md"), buildMarkdown(dimensions, overall));

  console.log("Phase 3 Evaluation Complete");
  console.log(`Overall Score: ${overall.toFixed(2)}`);
}

main().catch((error) => {
  console.error("Evaluation failed:", error);
  process.exit(1);
});
