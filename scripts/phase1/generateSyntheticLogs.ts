import fs from "fs";
import path from "path";

type Level = "INFO" | "WARN" | "ERROR";
type Service = "auth" | "payments" | "orders" | "gateway";

type CanonicalLog = {
  timestamp?: string;
  service?: Service;
  level?: Level;
  message?: string;
  request_id?: string;
  ts?: string;
  svc?: Service;
  lvl?: Level;
  reqId?: string;
};

const TOTAL_LOGS = 500;
const START_TIME = new Date("2026-04-10T13:50:00Z");
const END_TIME = new Date("2026-04-10T14:40:00Z");
const FAILURE_START = new Date("2026-04-10T14:00:00Z");

const services: Service[] = ["auth", "payments", "orders", "gateway"];

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(items: T[]): T {
  if (items.length === 0) {
    throw new Error("Cannot pick from an empty array");
  }
  return items[randomInt(0, items.length - 1)]!;
}

function assignIfDefined<K extends keyof CanonicalLog>(
  target: CanonicalLog,
  key: K,
  value: CanonicalLog[K] | undefined,
): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

function buildTimestamp(i: number): Date {
  const spanMs = END_TIME.getTime() - START_TIME.getTime();
  const step = spanMs / (TOTAL_LOGS - 1);
  const jitterMs = randomInt(-2500, 2500);
  return new Date(START_TIME.getTime() + i * step + jitterMs);
}

function phaseErrorWeight(ts: Date): number {
  if (ts < FAILURE_START) return 0.03;
  const minutesAfter = (ts.getTime() - FAILURE_START.getTime()) / 60000;
  return Math.min(0.75, 0.08 + minutesAfter * 0.02);
}

function chooseLevel(ts: Date): Level {
  const pError = phaseErrorWeight(ts);
  const pWarn = ts < FAILURE_START ? 0.12 : Math.min(0.32, 0.16 + pError * 0.4);
  const r = Math.random();
  if (r < pError) return "ERROR";
  if (r < pError + pWarn) return "WARN";
  return "INFO";
}

function buildMessage(service: Service, level: Level, ts: Date): string {
  const afterFailure = ts >= FAILURE_START;

  const stableInfo: Record<Service, string[]> = {
    auth: [
      "Token validated successfully",
      "Session refreshed",
      "OIDC metadata cache hit",
    ],
    payments: [
      "Payment authorization completed",
      "Card token lookup succeeded",
      "Ledger write committed",
    ],
    orders: [
      "Order state transitioned to PROCESSING",
      "Order projection updated",
      "Inventory reservation confirmed",
    ],
    gateway: [
      "Request routed to backend",
      "Rate limiter check passed",
      "Response compressed and returned",
    ],
  };

  const warningMsgs: Record<Service, string[]> = {
    auth: [
      "Token validation latency increased",
      "JWKS endpoint slow response",
      "Auth cache nearing eviction threshold",
    ],
    payments: [
      "Retrying PSP call due to elevated latency",
      "Payment idempotency lock wait detected",
      "Database connection pool saturation warning",
    ],
    orders: [
      "Order event processing delay observed",
      "Inventory service returned stale data",
      "Order write queue lag increased",
    ],
    gateway: [
      "Upstream latency trend increasing",
      "Gateway retries exceeded baseline",
      "Circuit breaker opened intermittently",
    ],
  };

  const dependencyErrors: Record<Service, string[]> = {
    auth: [
      "Auth dependency failure: identity-provider timeout",
      "Auth dependency failure: redis session store unreachable",
    ],
    payments: [
      "Dependency failure: gateway->payments timeout",
      "Dependency failure: orders->payments RPC connection reset",
      "PSP dependency returned 502 for charge request",
    ],
    orders: [
      "Dependency failure: orders->inventory read timeout",
      "Dependency failure: orders->payments status lookup failed",
      "Kafka dependency failure while publishing order event",
    ],
    gateway: [
      "Dependency failure: gateway->auth token introspection timeout",
      "Dependency failure: gateway->orders upstream returned 503",
      "Dependency failure: gateway->payments upstream closed connection",
    ],
  };

  if (!afterFailure) {
    if (level === "INFO") return pick(stableInfo[service]);
    if (level === "WARN") return pick(warningMsgs[service]);
    return `${service} encountered transient error before incident window`;
  }

  if (level === "ERROR") {
    const minute = Math.floor((ts.getTime() - FAILURE_START.getTime()) / 60000);
    const suffix = minute > 20 ? " (escalating impact)" : "";
    return `${pick(dependencyErrors[service])}${suffix}`;
  }

  if (level === "WARN") {
    return `${pick(warningMsgs[service])} (post-14:00 degradation)`;
  }

  return `${pick(stableInfo[service])} (degraded environment)`;
}

function maybeInconsistent(record: CanonicalLog): CanonicalLog {
  const r = Math.random();

  // Around 10% use alternate field names to simulate schema drift.
  if (r < 0.1) {
    const inconsistent: CanonicalLog = {};
    assignIfDefined(inconsistent, "ts", record.timestamp);
    assignIfDefined(inconsistent, "svc", record.service);
    assignIfDefined(inconsistent, "lvl", record.level);
    assignIfDefined(inconsistent, "message", record.message);
    assignIfDefined(inconsistent, "reqId", record.request_id);
    return inconsistent;
  }

  // Around 10% miss a random field.
  if (r < 0.2) {
    const keys: Array<keyof CanonicalLog> = [
      "timestamp",
      "service",
      "level",
      "message",
      "request_id",
    ];
    const keyToDrop = pick(keys);
    const copy: CanonicalLog = { ...record };
    delete copy[keyToDrop];
    return copy;
  }

  return record;
}

function main(): void {
  const logs: CanonicalLog[] = [];

  for (let i = 0; i < TOTAL_LOGS; i += 1) {
    const ts = buildTimestamp(i);
    const service = pick(services);
    const level = chooseLevel(ts);

    const record: CanonicalLog = {
      timestamp: ts.toISOString(),
      service,
      level,
      message: buildMessage(service, level, ts),
      request_id: `req_${1000 + i}`,
    };

    logs.push(maybeInconsistent(record));
  }

  logs.sort((a, b) => {
    const ta = new Date(a.timestamp ?? a.ts ?? "1970-01-01T00:00:00Z").getTime();
    const tb = new Date(b.timestamp ?? b.ts ?? "1970-01-01T00:00:00Z").getTime();
    return ta - tb;
  });

  const outPath = path.resolve(process.cwd(), "data/synthetic/phase1/logs_step1.json");
  fs.writeFileSync(outPath, JSON.stringify(logs, null, 2), "utf8");

  console.log(`Generated ${logs.length} logs at ${outPath}`);
}

main();
