import fs from "fs";
import path from "path";

type SyntheticTicket = {
  ticket_id: string;
  title: string;
  description: string;
  service: string;
  timestamp: string;
  resolution?: string;
};

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

function main(): void {
  const syntheticPath = path.resolve("data/synthetic/phase1/tickets_step2.json");
  const publicPath = path.resolve("data/public/phase1/public_incidents_step0.json");
  const outputPath = path.resolve("data/combined/phase1/merged_incidents.json");

  const synthetic = JSON.parse(fs.readFileSync(syntheticPath, "utf-8")) as SyntheticTicket[];
  const publicIncidents = JSON.parse(fs.readFileSync(publicPath, "utf-8")) as PublicIncidentRecord[];

  const merged = [
    ...publicIncidents.map((incident) => ({
      source: "public",
      incident_id: incident.incident_id,
      title: incident.title,
      description: incident.description,
      service: incident.service_hint,
      timestamp: incident.timestamp,
      resolution: incident.resolution_notes,
      metadata: {
        priority: incident.priority,
        category: incident.category,
      },
    })),
    ...synthetic.map((ticket) => ({
      source: "synthetic",
      incident_id: ticket.ticket_id,
      title: ticket.title,
      description: ticket.description,
      service: ticket.service,
      timestamp: ticket.timestamp,
      resolution: ticket.resolution || "",
      metadata: {},
    })),
  ].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(merged, null, 2));
  console.log(`Merged ${publicIncidents.length} public and ${synthetic.length} synthetic incidents into ${outputPath}`);
}

main();
