import fs from "fs";
import path from "path";
import { ChatOllama } from "@langchain/ollama";
import { z } from "zod";

// ─── Schema ────────────────────────────────────────────────────────────────

const DeploymentSchema = z.object({
  service: z.string(),
  version: z.string(),
  timestamp: z.string(),
  change_description: z.string(),
  is_breaking_change: z.boolean().optional(),
});

const BatchSchema = z.object({
  deployments: z.array(DeploymentSchema),
});

type Deployment = z.infer<typeof DeploymentSchema>;

// ─── Config ──────────────────────────────────────────────────────────────────

const MODEL = "llama3";
const TOTAL_DEPLOYMENTS = 40;
const BATCH_SIZE = 10;
const OUTPUT_PATH = path.resolve("data/synthetic/phase1/deployments_step4.json");

// Deployment time window: 2026-04-10 10:00 UTC to 14:30 UTC
const START_TIME = new Date("2026-04-10T10:00:00Z");
const END_TIME = new Date("2026-04-10T14:30:00Z");
const INCIDENT_TIME = new Date("2026-04-10T14:00:00Z");

const SERVICES = ["auth-service", "payments-service", "orders-service", "gateway-service"];

// ─── Batch Themes ──────────────────────────────────────────────────────────

const BATCH_THEMES: string[] = [
  // Batch 0 (early morning, pre-incident) – routine deployments
  `Generate 10 deployment records for the morning before an incident.
These are routine deployments across services from 10:00 to 11:30 UTC on 2026-04-10.
Include normal version bumps like v1.x.y → v1.x.(y+1) or v2.x.y → v2.x.(y+1).
Include feature additions, bug fixes, performance improvements, and dependency updates.`,

  // Batch 1 (late morning, pre-incident) – mid-deployment period
  `Generate 10 deployment records from 11:30 to 12:30 UTC on 2026-04-10 (before incident).
These should be from multiple services, including some more significant changes.
Versions should progress naturally (e.g., auth-service v2.0.5 → v2.1.0, orders-service v1.7.8 → v1.8.0).
Include database schema changes, configuration updates, and library upgrades.`,

  // Batch 2 (pre-incident critical) – includes breaking change
  `Generate 10 deployment records from 12:30 to 13:55 UTC on 2026-04-10 (just before incident).
IMPORTANT: Include AT LEAST TWO breaking changes that would cause the incident:
- auth-service: refactored token validation logic with new JWT parsing rules (breaking if secrets aren't rotated first)
- payments-service: updated payment gateway integration with stricter error handling
Include timestamps spreading across this window, with one or two major version changes (v1.x.y → v2.0.0 style).
Mark these breaking changes by setting "is_breaking_change": true in the JSON.`,

  // Batch 3 (post-incident, early remediation) – emergency fixes and rollbacks
  `Generate 10 deployment records from 14:00 to 14:30 UTC on 2026-04-10 (after incident started).
These are emergency deployments and rollbacks in response to the incident.
Include version rollbacks (e.g., v2.1.3 → v2.1.2), hotfixes (v2.1.3 → v2.1.3-hotfix.1), and feature flag toggles.
Timestamps should show urgency (rapid deployments within minutes of each other).
Examples: "Rolled back auth-service to v2.0.5", "Disabled new token validation in feature flags", "Hotfix for JWT secret rotation".`,
];

// ─── Prompt Builder ──────────────────────────────────────────────────────────

function buildPrompt(theme: string): string {
  return `You are a deployment system historian generating realistic production deployment records.

${theme}

Rules:
- Use exactly ${BATCH_SIZE} deployment records
- Timestamps must be ISO-8601 on 2026-04-10 in the UTC timezone, within the time window specified above
- Services must be one of: auth-service, payments-service, orders-service, gateway-service
- Versions must be semantic (e.g., v1.2.3, v2.0.0, v1.8.2-hotfix.1)
- change_description should be 1-2 sentences describing what changed (library upgrades, bug fixes, schema changes, feature additions, etc.)
- For breaking changes marked with "is_breaking_change": true, make the description reflect the significance (e.g., "Refactored token validation logic", "Updated payment gateway integration")
- Do NOT add any commentary outside the JSON

Return a JSON object with a "deployments" array containing exactly ${BATCH_SIZE} records.`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── LLM Setup ────────────────────────────────────────────────────────────────

const llm = new ChatOllama({ model: MODEL, temperature: 0.75 });
const structured = llm.withStructuredOutput(BatchSchema, { name: "deployment_batch" });

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const allDeployments: Deployment[] = [];
  const batches = Math.ceil(TOTAL_DEPLOYMENTS / BATCH_SIZE);

  console.log(`Generating ${TOTAL_DEPLOYMENTS} deployment records in ${batches} batches…`);
  console.log(`Model: ${MODEL}  |  Output: ${OUTPUT_PATH}\n`);

  // Ensure output directory exists
  const dir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  for (let b = 0; b < batches; b++) {
    const theme = BATCH_THEMES[b] ?? BATCH_THEMES[BATCH_THEMES.length - 1]!;
    process.stdout.write(`  Batch ${b + 1}/${batches}  `);

    let attempt = 0;
    while (attempt < 3) {
      try {
        const result = await structured.invoke(buildPrompt(theme));
        const deployments = result.deployments.slice(0, BATCH_SIZE);
        allDeployments.push(...deployments);
        fs.writeFileSync(OUTPUT_PATH, JSON.stringify(allDeployments, null, 2), "utf-8");
        console.log(`✓ (${deployments.length} records)`);
        break;
      } catch (err) {
        attempt++;
        if (attempt >= 3) {
          console.error(`\n  ✗ Batch ${b + 1} failed after 3 attempts:`, err);
        } else {
          console.warn(`\n  ⚠ Attempt ${attempt} failed, retrying…`);
          await sleep(2000);
        }
      }
    }

    if (b < batches - 1) await sleep(500);
  }

  const breakingCount = allDeployments.filter((d) => d.is_breaking_change).length;

  console.log(`\nDone!`);
  console.log(`  Total deployments    : ${allDeployments.length}`);
  console.log(`  Breaking changes     : ${breakingCount}`);
  console.log(`  Output               : ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
