import fs from "fs";
import path from "path";
import { ChatOllama } from "@langchain/ollama";
import { z } from "zod";

// ─── Schema ────────────────────────────────────────────────────────────────

const TicketSchema = z.object({
  ticket_id: z.string(),
  title: z.string(),
  description: z.string(),
  service: z.string(),
  timestamp: z.string(),
  resolution: z.string().optional(),
});

const BatchSchema = z.object({
  tickets: z.array(TicketSchema),
});

type Ticket = z.infer<typeof TicketSchema>;

// ─── Config ─────────────────────────────────────────────────────────────────

const MODEL = "llama3";
const TOTAL_TICKETS = 100;
const BATCH_SIZE = 10;
const OUTPUT_PATH = path.resolve("data/synthetic/phase1/tickets_step2.json");

// Ticket IDs start at INC-2001 to avoid collision with sample output (INC-1023+)
const ID_OFFSET = 2001;

// ─── Batch Prompts ───────────────────────────────────────────────────────────
//
// Each batch has a theme so collectively the 100 tickets have:
//   • Authentic incident variety across all services
//   • Duplicate issues expressed with different wording (batches 2 & 7, 4 & 9)
//   • Tickets with partial or incorrect root-cause assumptions
//

const BATCH_THEMES: string[] = [
  // Batch 0 (INC-2001..2010) – Auth service failures
  `Generate 10 incident tickets about authentication service failures.
Include 2 tickets that describe the same "users cannot log in" scenario but with completely different wording, framing, and reporter perspective.
For 2 tickets include a plausible but INCORRECT assumption in the description (e.g. blaming the database when the real issue was a misconfigured JWT secret).`,

  // Batch 1 (INC-2011..2020) – Orders service degradation
  `Generate 10 incident tickets about the orders service being slow or unavailable.
Include 1 ticket where the reporter partially understands the cause (correctly identifies high latency but incorrectly blames the payments service instead of a database connection pool exhaustion).
Include 1 ticket that duplicates another ticket's scenario with different wording (e.g. "orders timing out" vs "checkout not completing").`,

  // Batch 2 (INC-2021..2030) – Payments failures and false alarms
  `Generate 10 incident tickets about payment processing issues.
Include 2 tickets that are duplicates of each other (same underlying payment gateway timeout, different titles and descriptions).
Include 1 ticket where the reporter has a completely wrong assumption about the root cause (blames front-end code when the issue is a third-party payment gateway outage).`,

  // Batch 3 (INC-2031..2040) – API gateway and routing issues
  `Generate 10 incident tickets about the API gateway returning 502/503 errors, routing failures, and SSL certificate issues.
Include 1 partial-understanding ticket where the reporter says "the entire platform is down" but only the gateway is affected.
Mix in 2 tickets with vague, incomplete descriptions as a real operator might file mid-incident.`,

  // Batch 4 (INC-2041..2050) – Database and storage layer
  `Generate 10 incident tickets about database slowness, connection pool exhaustion, and storage I/O issues across services.
Include 1 duplicate of an earlier "orders service slow" complaint (different wording, different reporter).
Include 2 tickets with incorrect root-cause assumptions (e.g. assuming high CPU on the app server when the real cause is a missing index).`,

  // Batch 5 (INC-2051..2060) – Deployment-related regressions
  `Generate 10 incident tickets about service regressions introduced by recent deployments.
Include rollbacks, feature-flag misfires, and canary release failures.
For 2 tickets include a plausible but wrong assumption (e.g. blaming infrastructure when a bad config value was deployed).`,

  // Batch 6 (INC-2061..2070) – Memory leaks and resource exhaustion
  `Generate 10 incident tickets about memory leaks, CPU spikes, and OOM kills across auth, payments, orders, and gateway services.
Include 1 duplicate (same OOM scenario described twice with different wording).
Include 1 ticket with a partial cause: reporter correctly identifies the service is restarting but incorrectly attributes it to a traffic spike rather than a memory leak.`,

  // Batch 7 (INC-2071..2080) – Network and dependency failures
  `Generate 10 incident tickets about network timeouts, DNS failures, and third-party dependency outages affecting microservices.
Include 2 tickets that duplicate earlier gateway/routing incidents but from a different team's perspective.
Include 2 tickets with incorrect assumptions (blaming the application layer when the issue is a network ACL or firewall rule).`,

  // Batch 8 (INC-2081..2090) – Monitoring, alerting, and on-call noise
  `Generate 10 incident tickets about false-positive alerts, alert storms, missing monitoring coverage, and on-call fatigue incidents.
Include 1 ticket where the reporter incorrectly assumes a real outage based on a mis-configured alert threshold.
Mix in 2 tickets that are near-duplicates (different alert names, same underlying misconfiguration).`,

  // Batch 9 (INC-2091..2100) – Mixed / cross-service cascade failures
  `Generate 10 incident tickets about cascading failures where one service's degradation triggers failures in downstream services.
Include 1 duplicate of the auth login failure described in a different way (e.g. "SSO broken" vs "LDAP sync failing").
Include 2 tickets with partial or incorrect assumptions about which service is the true root cause.`,
];

// ─── LLM Setup ───────────────────────────────────────────────────────────────

const llm = new ChatOllama({ model: MODEL, temperature: 0.85 });
const structured = llm.withStructuredOutput(BatchSchema, { name: "incident_batch" });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildPrompt(theme: string, startId: number): string {
  const ids = Array.from({ length: BATCH_SIZE }, (_, i) => `INC-${startId + i}`).join(", ");
  return `You are a Site Reliability Engineer writing production incident tickets.

${theme}

Rules:
- Use exactly these ticket_ids in order: ${ids}
- Timestamps must be ISO-8601, on 2026-04-10, between 13:50 and 15:30 UTC
- Services must be one of: auth-service, payments-service, orders-service, gateway-service
- Descriptions should be 2-4 sentences of natural, realistic operator language (abbreviations, urgency, uncertainty are fine)
- The "resolution" field is optional — include it for ~60% of tickets
- Do NOT add any commentary outside the JSON

Return a JSON object with a "tickets" array containing exactly ${BATCH_SIZE} tickets.`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const allTickets: Ticket[] = [];
  const batches = Math.ceil(TOTAL_TICKETS / BATCH_SIZE);

  console.log(`Generating ${TOTAL_TICKETS} incident tickets in ${batches} batches of ${BATCH_SIZE}…`);
  console.log(`Model: ${MODEL}  |  Output: ${OUTPUT_PATH}\n`);

  // Ensure output directory exists before first write
  const dir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  for (let b = 0; b < batches; b++) {
    const startId = ID_OFFSET + b * BATCH_SIZE;
    const theme = BATCH_THEMES[b] ?? BATCH_THEMES[BATCH_THEMES.length - 1]!;
    const prompt = buildPrompt(theme, startId);

    process.stdout.write(`  Batch ${b + 1}/${batches} (INC-${startId}…INC-${startId + BATCH_SIZE - 1})  `);

    let attempt = 0;
    while (attempt < 3) {
      try {
        const result = await structured.invoke(prompt);
        const tickets = result.tickets.slice(0, BATCH_SIZE);
        allTickets.push(...tickets);
        // Write incrementally after each successful batch
        fs.writeFileSync(OUTPUT_PATH, JSON.stringify(allTickets, null, 2), "utf-8");
        console.log(`✓ (${tickets.length} tickets)`);
        break;
      } catch (err) {
        attempt++;
        if (attempt >= 3) {
          console.error(`\n  ✗ Batch ${b + 1} failed after 3 attempts:`, err);
          // Push placeholder tickets so IDs remain consistent
          for (let i = 0; i < BATCH_SIZE; i++) {
            allTickets.push({
              ticket_id: `INC-${startId + i}`,
              title: "GENERATION_FAILED",
              description: "This ticket could not be generated.",
              service: "unknown",
              timestamp: "2026-04-10T14:00:00Z",
            });
          }
          fs.writeFileSync(OUTPUT_PATH, JSON.stringify(allTickets, null, 2), "utf-8");
        } else {
          console.warn(`\n  ⚠ Attempt ${attempt} failed, retrying…`);
          await sleep(2000);
        }
      }
    }

    // Small pause between batches to avoid overwhelming local Ollama
    if (b < batches - 1) await sleep(500);
  }

  const withResolution = allTickets.filter((t) => t.resolution).length;
  const failed = allTickets.filter((t) => t.title === "GENERATION_FAILED").length;

  console.log(`\nDone!`);
  console.log(`  Total tickets  : ${allTickets.length}`);
  console.log(`  With resolution: ${withResolution}`);
  if (failed > 0) console.warn(`  Failed         : ${failed}`);
  console.log(`  Output         : ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
