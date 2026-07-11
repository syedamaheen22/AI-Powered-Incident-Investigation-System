import fs from "fs";
import path from "path";

type PublicIncidentRecord = {
  incident_id: string;
  title: string;
  description: string;
  priority: string;
  category: string;
  resolution_notes: string;
  timestamp: string;
  service_hint: string;
};

type CsvRow = Record<string, string>;

const KNOWN_SERVICES = [
  "auth-service",
  "gateway-service",
  "orders-service",
  "payments-service",
] as const;

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values.map((value) => value.trim());
}

function normalizePriority(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "critical") {
    return "P1";
  }
  if (normalized === "high") {
    return "P2";
  }
  if (normalized === "medium") {
    return "P3";
  }
  if (normalized === "low") {
    return "P4";
  }
  return "P3";
}

function toIsoTimestamp(value: string): string {
  const raw = value.trim();
  if (!raw) {
    return "";
  }

  if (raw.includes("T")) {
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? "" : new Date(parsed).toISOString();
  }

  const normalized = raw.replace(" ", "T") + "Z";
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? "" : new Date(parsed).toISOString();
}

function pickServiceHint(incidentType: string, assignedDepartment: string, incidentId: string): string {
  const type = incidentType.toLowerCase();
  const department = assignedDepartment.toLowerCase();

  if (type.includes("auth") || type.includes("access") || department.includes("security")) {
    return "auth-service";
  }
  if (type.includes("network") || type.includes("gateway") || department.includes("network")) {
    return "gateway-service";
  }
  if (type.includes("database") || type.includes("order") || department.includes("database")) {
    return "orders-service";
  }
  if (type.includes("payment") || type.includes("checkout")) {
    return "payments-service";
  }

  const digits = incidentId.replace(/\D/g, "");
  const index = digits ? Number(digits) % KNOWN_SERVICES.length : 0;
  return KNOWN_SERVICES[index] || "gateway-service";
}

function mapRowToPublicIncident(row: CsvRow): PublicIncidentRecord {
  if (row.incident_id) {
    return {
      incident_id: row.incident_id,
      title: row.title || "",
      description: row.description || "",
      priority: row.priority || "",
      category: row.category || "",
      resolution_notes: row.resolution_notes || "",
      timestamp: row.timestamp || "",
      service_hint: row.service_hint || "",
    };
  }

  const incidentId = row.Incident_ID || "";
  const incidentType = row.Incident_Type || "IT Incident";
  const priority = normalizePriority(row.Priority || "");
  const location = row.Location || "unknown location";
  const assignedDepartment = row.Assigned_Department || "unknown team";
  const status = row.Status || "Open";
  const reportedTime = toIsoTimestamp(row.Reported_Time || "");
  const resolvedTime = toIsoTimestamp(row.Resolved_Time || "");
  const resolutionHours = row.Resolution_Time_Hours || "unknown";
  const resolutionType = row.Resolution_Type || "Pending";

  const title = `${incidentType} at ${location}`;
  const description = `${incidentType} reported by ${assignedDepartment} at ${location}. Current status: ${status}.`;
  const resolutionNotes = `Resolution: ${resolutionType}; status: ${status}; resolved_time: ${resolvedTime || "n/a"}; resolution_hours: ${resolutionHours}`;

  return {
    incident_id: incidentId,
    title,
    description,
    priority,
    category: incidentType,
    resolution_notes: resolutionNotes,
    timestamp: reportedTime,
    service_hint: pickServiceHint(incidentType, assignedDepartment, incidentId),
  };
}

function main(): void {
  const inputPath = path.resolve("data/public/it_incident_public_sample.csv");
  const outputPath = path.resolve("data/public/phase1/public_incidents_step0.json");

  const csv = fs.readFileSync(inputPath, "utf-8").trim().split(/\r?\n/);
  const headerLine = csv[0] || "";
  const headers = parseCsvLine(headerLine);
  const records: PublicIncidentRecord[] = csv.slice(1).map((line) => {
    const fields = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, fields[index] || ""])) as CsvRow;
    return mapRowToPublicIncident(row);
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(records, null, 2));
  console.log(`Imported ${records.length} public incident records to ${outputPath}`);
}

main();
