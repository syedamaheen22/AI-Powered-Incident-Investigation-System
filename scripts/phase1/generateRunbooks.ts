import fs from "fs";
import path from "path";
import { ChatOllama } from "@langchain/ollama";
import { StringOutputParser } from "@langchain/core/output_parsers";

// ─── Config ──────────────────────────────────────────────────────────────────

const MODEL = "llama3";
const OUTPUT_DIR = path.resolve("data/synthetic/phase1/runbooks");

// ─── Services ────────────────────────────────────────────────────────────────

const SERVICES = [
  {
    name: "auth-service",
    filename: "auth-service-runbook.md",
    context: `
- Handles user authentication, JWT token issuance and validation, session management
- Depends on: redis-cache (session storage), user-db (user credentials), ldap-service (optional SSO)
- Exposes: /login, /logout, /validate-token, /refresh-token
- Known pain points: JWT secret rotation causes brief token rejection windows; Redis eviction under load drops sessions silently
- Recent incidents: deployment rollback after bad JWT config push; intermittent 401s during Redis failover
`,
  },
  {
    name: "payments-service",
    filename: "payments-service-runbook.md",
    context: `
- Handles payment processing, refunds, transaction ledger
- Depends on: payments-db (postgres), stripe-gateway (third-party), orders-service (order validation), fraud-detection (async)
- Exposes: /charge, /refund, /transaction/:id, /webhook/stripe
- Known pain points: Stripe webhook delivery retries cause duplicate charge attempts if idempotency keys aren't cached; DB connection pool exhaustion under peak load
- Recent incidents: false duplicate charges during Stripe outage; payment timeouts blamed incorrectly on frontend
`,
  },
  {
    name: "orders-service",
    filename: "orders-service-runbook.md",
    context: `
- Manages order creation, status tracking, fulfilment pipeline
- Depends on: orders-db (postgres), inventory-service, payments-service, notifications-service (async)
- Exposes: /orders, /orders/:id, /orders/:id/status, /orders/:id/cancel
- Known pain points: DB connection pool exhaustion when inventory-service is slow (synchronous calls); missing index on order_status column causes full table scans under load
- Recent incidents: checkout failures during DB pool exhaustion; cascading delays when payments-service was slow
`,
  },
  {
    name: "gateway-service",
    filename: "gateway-service-runbook.md",
    context: `
- API gateway — routes all external traffic to internal services, handles rate limiting, auth token forwarding, SSL termination
- Depends on: auth-service (token validation), all downstream services
- Exposes: all public API routes under /api/v1/*
- Known pain points: SSL certificate renewal requires service restart; rate-limit config hot-reload sometimes fails silently; upstream timeout defaults too aggressive for slow upstream responses
- Recent incidents: 502 storm when auth-service was slow (gateway timeout too short); SSL cert expiry caused full outage; routing rule pushed incorrectly blocked /api/v1/orders
`,
  },
];

// ─── Prompt ───────────────────────────────────────────────────────────────────

function buildPrompt(service: (typeof SERVICES)[number]): string {
  return `You are a senior SRE writing an internal troubleshooting runbook for the ${service.name}.

Service context:
${service.context.trim()}

Write a realistic runbook in Markdown. It must include these sections in order:

# ${service.name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} Runbook

## Overview
One or two sentences describing what the service does.

## Dependencies
Bullet list of upstream/downstream dependencies with a brief note on each.

## Common Issues
Bullet list of 4–6 realistic failure modes operators actually see.

## Troubleshooting Steps
Numbered steps for diagnosing the most common issues. Mix in:
- Specific log grep commands (realistic but slightly vague, like real docs)
- kubectl / docker commands
- At least one step that says something like "check with the platform team" or "usually resolves itself after a few minutes"
- At least one step with an outdated or partially wrong assumption (like real internal docs)

## Escalation Policy
Short paragraph on when to escalate, who owns the service, and an on-call rotation note that references a Slack channel.

## Known Limitations / TODOs
2–4 bullet points of known gaps in monitoring, missing runbook sections, or toil that hasn't been automated yet. Use the vague, honest tone of real internal docs ("we should probably...", "no one has done this yet").

Rules:
- Use realistic service/team names, Slack channels, and tool names (Datadog, PagerDuty, Grafana, kubectl, etc.)
- Keep language natural, slightly informal in places — this is internal documentation
- Do NOT add any commentary outside the Markdown
`;
}

// ─── LLM Setup ───────────────────────────────────────────────────────────────

const llm = new ChatOllama({ model: MODEL, temperature: 0.7 });
const parser = new StringOutputParser();
const chain = llm.pipe(parser);

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`Generating runbooks for ${SERVICES.length} services…`);
  console.log(`Model: ${MODEL}  |  Output dir: ${OUTPUT_DIR}\n`);

  for (const service of SERVICES) {
    const outPath = path.join(OUTPUT_DIR, service.filename);
    process.stdout.write(`  ${service.name}  …  `);

    let attempt = 0;
    while (attempt < 3) {
      try {
        const content = await chain.invoke(buildPrompt(service));
        fs.writeFileSync(outPath, content.trim() + "\n", "utf-8");
        console.log(`✓  →  ${path.relative(process.cwd(), outPath)}`);
        break;
      } catch (err) {
        attempt++;
        if (attempt >= 3) {
          console.error(`\n  ✗ Failed after 3 attempts:`, err);
        } else {
          console.warn(`\n  ⚠ Attempt ${attempt} failed, retrying…`);
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }
  }

  console.log(`\nDone! Runbooks written to ${OUTPUT_DIR}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
