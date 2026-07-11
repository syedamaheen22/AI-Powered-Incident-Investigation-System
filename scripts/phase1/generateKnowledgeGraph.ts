import fs from "fs";
import path from "path";

// ─── Schema ───────────────────────────────────────────────────────────────

interface ServiceNode {
  id: string;
  type: "service" | "external" | "storage";
  owner: string;
  region: string;
  description?: string;
}

interface DependencyEdge {
  source: string;
  target: string;
  relationship: "depends_on" | "calls" | "stores_in" | "notifies";
}

interface ServiceGraph {
  nodes: ServiceNode[];
  edges: DependencyEdge[];
}

// ─── Service Definitions ──────────────────────────────────────────────────

const NODES: ServiceNode[] = [
  // Internal services
  {
    id: "auth-service",
    type: "service",
    owner: "team-auth",
    region: "us-east-1",
    description: "User authentication and token management",
  },
  {
    id: "orders-service",
    type: "service",
    owner: "team-orders",
    region: "us-east-1",
    description: "Order creation and fulfillment pipeline",
  },
  {
    id: "payments-service",
    type: "service",
    owner: "team-payments",
    region: "eu-west-1",
    description: "Payment processing and transaction ledger",
  },
  {
    id: "gateway-service",
    type: "service",
    owner: "team-platform",
    region: "us-east-1",
    description: "API gateway and routing layer",
  },
  {
    id: "notifications-service",
    type: "service",
    owner: "team-platform",
    region: "us-east-1",
    description: "Email and SMS notifications",
  },

  // Storage and cache
  {
    id: "redis-cache",
    type: "storage",
    owner: "team-platform",
    region: "us-east-1",
    description: "Session storage and distributed cache",
  },
  {
    id: "user-db",
    type: "storage",
    owner: "team-auth",
    region: "us-east-1",
    description: "User credentials and profile data",
  },
  {
    id: "orders-db",
    type: "storage",
    owner: "team-orders",
    region: "us-east-1",
    description: "Order records and fulfillment state",
  },
  {
    id: "payments-db",
    type: "storage",
    owner: "team-payments",
    region: "eu-west-1",
    description: "Payment transactions and ledger",
  },

  // External services
  {
    id: "stripe-gateway",
    type: "external",
    owner: "stripe-inc",
    region: "global",
    description: "Third-party payment processor",
  },
  {
    id: "ldap-service",
    type: "external",
    owner: "corporate-it",
    region: "us-east-1",
    description: "Single sign-on provider (optional)",
  },
  {
    id: "sendgrid-api",
    type: "external",
    owner: "sendgrid",
    region: "global",
    description: "Email delivery service",
  },
];

// ─── Dependency Edges ─────────────────────────────────────────────────────

const EDGES: DependencyEdge[] = [
  // Auth service dependencies
  { source: "auth-service", target: "redis-cache", relationship: "stores_in" },
  { source: "auth-service", target: "user-db", relationship: "stores_in" },
  { source: "auth-service", target: "ldap-service", relationship: "depends_on" },

  // Orders service dependencies
  { source: "orders-service", target: "auth-service", relationship: "calls" },
  { source: "orders-service", target: "payments-service", relationship: "calls" },
  { source: "orders-service", target: "orders-db", relationship: "stores_in" },
  { source: "orders-service", target: "notifications-service", relationship: "calls" },

  // Payments service dependencies
  { source: "payments-service", target: "payments-db", relationship: "stores_in" },
  { source: "payments-service", target: "stripe-gateway", relationship: "depends_on" },
  { source: "payments-service", target: "auth-service", relationship: "calls" },

  // Gateway service dependencies (ingress point)
  { source: "gateway-service", target: "auth-service", relationship: "calls" },
  { source: "gateway-service", target: "orders-service", relationship: "calls" },
  { source: "gateway-service", target: "payments-service", relationship: "calls" },

  // Notifications service dependencies
  { source: "notifications-service", target: "sendgrid-api", relationship: "depends_on" },
  { source: "notifications-service", target: "redis-cache", relationship: "stores_in" },

  // Cross-service calls
  { source: "auth-service", target: "notifications-service", relationship: "calls" },
];

// ─── Output ──────────────────────────────────────────────────────────────

const OUTPUT_PATH = path.resolve("data/synthetic/phase1/knowledge_graph_step5.json");

function main(): void {
  const graph: ServiceGraph = {
    nodes: NODES,
    edges: EDGES,
  };

  const dir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(graph, null, 2), "utf-8");

  console.log(`Generated knowledge graph`);
  console.log(`  Nodes (services, storage, external): ${NODES.length}`);
  console.log(`  Edges (dependencies):                ${EDGES.length}`);
  console.log(`  Output: ${OUTPUT_PATH}`);
}

main();
