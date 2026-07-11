import fs from "fs";
import path from "path";

// ─── Types ───────────────────────────────────────────────────────────────

interface Node {
  id: string;
  type: "service" | "storage" | "external";
  owner: string;
  region: string;
  description: string;
}

interface Edge {
  source: string;
  target: string;
  relationship: "depends_on" | "calls" | "stores_in" | "notifies";
}

interface GraphData {
  nodes: Node[];
  edges: Edge[];
}

interface DependencyPath {
  path: string[];
  relationships: string[];
  depth: number;
}

interface ImpactAnalysisResult {
  affected_node: string;
  affected_type: string;
  impact_path: string[];
  relationship_chain: string[];
  depth: number;
}

interface TraversalResult {
  start_node: string;
  direction: "downstream" | "upstream";
  direct_dependencies: string[];
  all_dependencies: DependencyPath[];
  summary: {
    total_affected: number;
    by_type: Record<string, string[]>;
  };
}

interface ImpactReport {
  failed_node: string;
  node_info: Node | undefined;
  direct_callers: string[];
  full_blast_radius: ImpactAnalysisResult[];
  critical_services_at_risk: string[];
  summary: {
    total_impacted: number;
    services_impacted: number;
    storage_impacted: number;
    external_impacted: number;
  };
}

// ─── Config ──────────────────────────────────────────────────────────────

const GRAPH_INPUT = path.resolve("data/synthetic/phase1/knowledge_graph_step5.json");
const PHASE2_OUTPUT_DIR = path.resolve("data/synthetic/phase2");

// ─── Graph Engine ────────────────────────────────────────────────────────

class KnowledgeGraph {
  private nodes: Map<string, Node> = new Map();
  // adjacency list: source → [(target, relationship)]
  private outEdges: Map<string, Array<{ target: string; relationship: string }>> = new Map();
  // reverse adjacency: target → [(source, relationship)]
  private inEdges: Map<string, Array<{ source: string; relationship: string }>> = new Map();

  load(data: GraphData): void {
    // Index nodes
    for (const node of data.nodes) {
      this.nodes.set(node.id, node);
      this.outEdges.set(node.id, []);
      this.inEdges.set(node.id, []);
    }

    // Index edges
    for (const edge of data.edges) {
      this.outEdges.get(edge.source)?.push({
        target: edge.target,
        relationship: edge.relationship,
      });
      this.inEdges.get(edge.target)?.push({
        source: edge.source,
        relationship: edge.relationship,
      });
    }

    console.log(`  ✓ Loaded ${this.nodes.size} nodes, ${data.edges.length} edges`);
  }

  getNode(id: string): Node | undefined {
    return this.nodes.get(id);
  }

  getAllNodes(): Node[] {
    return Array.from(this.nodes.values());
  }

  // ─── Dependency Traversal ────────────────────────────────────────────
  // From a given node, walk downstream (what does it depend on?)

  getDirectDependencies(nodeId: string): string[] {
    return (this.outEdges.get(nodeId) || []).map((e) => e.target);
  }

  getDirectCallers(nodeId: string): string[] {
    return (this.inEdges.get(nodeId) || []).map((e) => e.source);
  }

  traverseDownstream(startId: string, maxDepth: number = 10): TraversalResult {
    const visited = new Set<string>();
    const paths: DependencyPath[] = [];

    const dfs = (
      nodeId: string,
      currentPath: string[],
      relationships: string[],
      depth: number,
    ): void => {
      if (depth > maxDepth || visited.has(nodeId)) return;
      visited.add(nodeId);

      const neighbors = this.outEdges.get(nodeId) || [];
      for (const { target, relationship } of neighbors) {
        const newPath = [...currentPath, target];
        const newRels = [...relationships, relationship];
        paths.push({ path: newPath, relationships: newRels, depth });
        dfs(target, newPath, newRels, depth + 1);
      }
    };

    dfs(startId, [startId], [], 0);

    const allDeps = Array.from(visited).filter((n) => n !== startId);

    // Group by node type
    const byType: Record<string, string[]> = {};
    for (const dep of allDeps) {
      const node = this.nodes.get(dep);
      const type = node?.type || "unknown";
      if (!byType[type]) byType[type] = [];
      byType[type].push(dep);
    }

    return {
      start_node: startId,
      direction: "downstream",
      direct_dependencies: this.getDirectDependencies(startId),
      all_dependencies: paths,
      summary: {
        total_affected: allDeps.length,
        by_type: byType,
      },
    };
  }

  traverseUpstream(startId: string, maxDepth: number = 10): TraversalResult {
    const visited = new Set<string>();
    const paths: DependencyPath[] = [];

    const dfs = (
      nodeId: string,
      currentPath: string[],
      relationships: string[],
      depth: number,
    ): void => {
      if (depth > maxDepth || visited.has(nodeId)) return;
      visited.add(nodeId);

      const callers = this.inEdges.get(nodeId) || [];
      for (const { source, relationship } of callers) {
        const newPath = [source, ...currentPath];
        const newRels = [relationship, ...relationships];
        paths.push({ path: newPath, relationships: newRels, depth });
        dfs(source, newPath, newRels, depth + 1);
      }
    };

    dfs(startId, [startId], [], 0);

    const allCallers = Array.from(visited).filter((n) => n !== startId);

    // Group by node type
    const byType: Record<string, string[]> = {};
    for (const caller of allCallers) {
      const node = this.nodes.get(caller);
      const type = node?.type || "unknown";
      if (!byType[type]) byType[type] = [];
      byType[type].push(caller);
    }

    return {
      start_node: startId,
      direction: "upstream",
      direct_dependencies: this.getDirectCallers(startId),
      all_dependencies: paths,
      summary: {
        total_affected: allCallers.length,
        by_type: byType,
      },
    };
  }

  // ─── Impact Analysis ─────────────────────────────────────────────────
  // If a node fails, who is impacted? Walk upstream callers recursively.

  analyzeImpact(failedNodeId: string): ImpactReport {
    const failedNode = this.nodes.get(failedNodeId);
    const impacted: ImpactAnalysisResult[] = [];
    const visited = new Set<string>();

    const bfs = (
      nodeId: string,
      path: string[],
      relChain: string[],
      depth: number,
    ): void => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      const callers = this.inEdges.get(nodeId) || [];
      for (const { source, relationship } of callers) {
        const callerNode = this.nodes.get(source);
        const newPath = [source, ...path];
        const newRels = [relationship, ...relChain];

        impacted.push({
          affected_node: source,
          affected_type: callerNode?.type || "unknown",
          impact_path: newPath,
          relationship_chain: newRels,
          depth,
        });

        bfs(source, newPath, newRels, depth + 1);
      }
    };

    bfs(failedNodeId, [failedNodeId], [], 1);

    const directCallers = this.getDirectCallers(failedNodeId);
    const criticalServices = impacted
      .filter((r) => r.affected_type === "service")
      .map((r) => r.affected_node);

    const services = impacted.filter((r) => r.affected_type === "service");
    const storage = impacted.filter((r) => r.affected_type === "storage");
    const external = impacted.filter((r) => r.affected_type === "external");

    return {
      failed_node: failedNodeId,
      node_info: failedNode,
      direct_callers: directCallers,
      full_blast_radius: impacted,
      critical_services_at_risk: [...new Set(criticalServices)],
      summary: {
        total_impacted: impacted.length,
        services_impacted: services.length,
        storage_impacted: storage.length,
        external_impacted: external.length,
      },
    };
  }

  // ─── Shortest Path ────────────────────────────────────────────────────
  // BFS to find the shortest dependency path between two nodes

  shortestPath(
    fromId: string,
    toId: string,
  ): { path: string[]; relationships: string[] } | null {
    if (fromId === toId) return { path: [fromId], relationships: [] };

    const queue: Array<{
      node: string;
      path: string[];
      rels: string[];
    }> = [{ node: fromId, path: [fromId], rels: [] }];

    const visited = new Set<string>([fromId]);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const neighbors = this.outEdges.get(current.node) || [];

      for (const { target, relationship } of neighbors) {
        if (visited.has(target)) continue;
        const newPath = [...current.path, target];
        const newRels = [...current.rels, relationship];

        if (target === toId) {
          return { path: newPath, relationships: newRels };
        }

        visited.add(target);
        queue.push({ node: target, path: newPath, rels: newRels });
      }
    }

    return null; // No path found
  }

  // ─── Full Graph Summary ───────────────────────────────────────────────

  getSummary(): Record<string, any> {
    const nodesByType: Record<string, string[]> = {};
    for (const node of this.nodes.values()) {
      if (!nodesByType[node.type]) nodesByType[node.type] = [];
      (nodesByType[node.type] as string[]).push(node.id);
    }

    const edgesByRelationship: Record<string, number> = {};
    for (const edges of this.outEdges.values()) {
      for (const { relationship } of edges) {
        edgesByRelationship[relationship] = (edgesByRelationship[relationship] || 0) + 1;
      }
    }

    // Most connected nodes (by total in+out degree)
    const degree: Array<{ node: string; in: number; out: number; total: number }> = [];
    for (const nodeId of this.nodes.keys()) {
      const inDeg = (this.inEdges.get(nodeId) || []).length;
      const outDeg = (this.outEdges.get(nodeId) || []).length;
      degree.push({ node: nodeId, in: inDeg, out: outDeg, total: inDeg + outDeg });
    }
    degree.sort((a, b) => b.total - a.total);

    return {
      total_nodes: this.nodes.size,
      total_edges: Array.from(this.outEdges.values()).reduce((sum, e) => sum + e.length, 0),
      nodes_by_type: nodesByType,
      edges_by_relationship: edgesByRelationship,
      most_connected: degree.slice(0, 5),
    };
  }
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("Knowledge Graph Engine - Phase 2 Task 2\n");

  // Load graph
  console.log("Loading knowledge graph...");
  const rawData: GraphData = JSON.parse(fs.readFileSync(GRAPH_INPUT, "utf-8"));
  const kg = new KnowledgeGraph();
  kg.load(rawData);

  const summary = kg.getSummary();
  console.log("\nGraph Summary:");
  console.log(`  Nodes: ${summary.total_nodes}, Edges: ${summary.total_edges}`);
  console.log(`  By type: ${JSON.stringify(summary.nodes_by_type, null, 0)}`);
  console.log(`  Most connected: ${summary.most_connected.map((n: any) => `${n.node}(${n.total})`).join(", ")}`);

  // ─── Dependency Traversal Examples ─────────────────────────────────

  console.log("\n" + "=".repeat(70));
  console.log("DEPENDENCY TRAVERSAL");
  console.log("=".repeat(70));

  const traversalTargets = ["gateway-service", "auth-service", "orders-service"];
  const traversalResults: TraversalResult[] = [];

  for (const nodeId of traversalTargets) {
    const downstream = kg.traverseDownstream(nodeId);
    traversalResults.push(downstream);

    console.log(`\n[${nodeId}] depends on (downstream):`);
    console.log(`  Direct: ${downstream.direct_dependencies.join(", ") || "none"}`);
    console.log(`  All (${downstream.summary.total_affected} total):`);
    for (const [type, nodes] of Object.entries(downstream.summary.by_type)) {
      console.log(`    ${type}: ${(nodes as string[]).join(", ")}`);
    }
  }

  // ─── Impact Analysis Examples ───────────────────────────────────────

  console.log("\n" + "=".repeat(70));
  console.log("IMPACT ANALYSIS (What breaks if X goes down?)");
  console.log("=".repeat(70));

  const failureScenarios = ["auth-service", "redis-cache", "stripe-gateway"];
  const impactReports: ImpactReport[] = [];

  for (const nodeId of failureScenarios) {
    const report = kg.analyzeImpact(nodeId);
    impactReports.push(report);

    console.log(`\n[${nodeId}] FAILS → blast radius:`);
    console.log(`  Direct callers: ${report.direct_callers.join(", ") || "none"}`);
    console.log(`  Total impacted: ${report.summary.total_impacted}`);
    console.log(`  Services at risk: ${report.critical_services_at_risk.join(", ") || "none"}`);
  }

  // ─── Shortest Path Examples ─────────────────────────────────────────

  console.log("\n" + "=".repeat(70));
  console.log("SHORTEST DEPENDENCY PATHS");
  console.log("=".repeat(70));

  const pathQueries = [
    { from: "gateway-service", to: "stripe-gateway" },
    { from: "gateway-service", to: "sendgrid-api" },
    { from: "orders-service", to: "user-db" },
  ];

  const pathResults: Array<{ from: string; to: string; result: any }> = [];

  for (const { from, to } of pathQueries) {
    const result = kg.shortestPath(from, to);
    pathResults.push({ from, to, result });

    if (result) {
      console.log(`\n${from} → ${to}:`);
      console.log(`  Path: ${result.path.join(" → ")}`);
      console.log(`  Via: ${result.relationships.join(", ")}`);
    } else {
      console.log(`\n${from} → ${to}: No path found`);
    }
  }

  // ─── Save output ─────────────────────────────────────────────────────

  if (!fs.existsSync(PHASE2_OUTPUT_DIR)) {
    fs.mkdirSync(PHASE2_OUTPUT_DIR, { recursive: true });
  }

  const output = {
    generated_at: new Date().toISOString(),
    graph_summary: summary,
    dependency_traversal: traversalResults,
    impact_analysis: impactReports,
    shortest_paths: pathResults,
  };

  const outputPath = path.join(PHASE2_OUTPUT_DIR, "knowledge_graph_analysis.json");
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\n✓ Results saved to ${outputPath}`);
}

main();
