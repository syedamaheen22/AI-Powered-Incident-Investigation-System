import fs from "fs";
import path from "path";
import { OllamaEmbeddings } from "@langchain/ollama";
import { BM25Retriever } from "@langchain/community/retrievers/bm25";
import { Document } from "@langchain/core/documents";

// ─── Types ───────────────────────────────────────────────────────────────

interface HybridSearchResult {
  content: string;
  score: number;
  source: string;
  service?: string;
  timestamp?: string;
  metadata: Record<string, any>;
}

interface VectorEntry {
  doc: Document;
  embedding: number[];
}

// ─── Config ──────────────────────────────────────────────────────────────

const PHASE1_DATA_DIR = path.resolve("data/synthetic/phase1");
const PHASE2_OUTPUT_DIR = path.resolve("data/synthetic/phase2");
const EMBEDDING_MODEL = "nomic-embed-text";

// ─── Utility: Cosine Similarity ───────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += (a[i] ?? 0) * (b[i] ?? 0);
    normA += (a[i] ?? 0) * (a[i] ?? 0);
    normB += (b[i] ?? 0) * (b[i] ?? 0);
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

// ─── Embedding Setup ─────────────────────────────────────────────────────

const embeddings = new OllamaEmbeddings({
  model: EMBEDDING_MODEL,
  baseUrl: "http://localhost:11434",
});

// ─── Document Loaders ───────────────────────────────────────────────────

function loadLogs(): Document[] {
  const logsPath = path.join(PHASE1_DATA_DIR, "logs_step1.json");
  const logs = JSON.parse(fs.readFileSync(logsPath, "utf-8"));

  return logs.map(
    (log: any, idx: number) =>
      new Document({
        pageContent: `[${log.level || "INFO"}] ${log.service || "unknown"} - ${log.message || ""}`,
        metadata: {
          type: "log",
          source: "logs_step1.json",
          service: log.service,
          level: log.level,
          timestamp: log.timestamp || log.ts,
          request_id: log.request_id || log.reqId,
          doc_id: `log_${idx}`,
        },
      }),
  );
}

function loadTickets(): Document[] {
  const ticketsPath = path.join(PHASE1_DATA_DIR, "tickets_step2.json");
  const tickets = JSON.parse(fs.readFileSync(ticketsPath, "utf-8"));

  return tickets.map(
    (ticket: any) =>
      new Document({
        pageContent: `TICKET ${ticket.ticket_id}: ${ticket.title}\n${ticket.description}`,
        metadata: {
          type: "ticket",
          source: "tickets_step2.json",
          ticket_id: ticket.ticket_id,
          title: ticket.title,
          service: ticket.service,
          timestamp: ticket.timestamp,
          resolution: ticket.resolution,
          doc_id: ticket.ticket_id,
        },
      }),
  );
}

function loadRunbooks(): Document[] {
  const runbooksDir = path.join(PHASE1_DATA_DIR, "runbooks");
  const docs: Document[] = [];

  if (!fs.existsSync(runbooksDir)) {
    console.warn("Runbooks directory not found");
    return docs;
  }

  fs.readdirSync(runbooksDir)
    .filter((f) => f.endsWith(".md"))
    .forEach((file) => {
      const content = fs.readFileSync(path.join(runbooksDir, file), "utf-8");
      // Split by sections for finer granularity
      const sections = content.split(/^## /m);

      sections.forEach((section, idx) => {
        if (section.trim()) {
          const title = section.split("\n")[0];
          const body = section.split("\n").slice(1).join("\n").trim();

          docs.push(
            new Document({
              pageContent: body || title || "untitled",
              metadata: {
                type: "runbook",
                source: file,
                service: file.replace("-runbook.md", ""),
                section: title,
                doc_id: `${file}_${idx}`,
              },
            }),
          );
        }
      });
    });

  return docs;
}

function loadDeployments(): Document[] {
  const deploymentsPath = path.join(PHASE1_DATA_DIR, "deployments_step4.json");
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf-8"));

  return deployments.map(
    (dep: any, idx: number) =>
      new Document({
        pageContent: `SERVICE: ${dep.service}\nVERSION: ${dep.version}\nCHANGE: ${dep.change_description}`,
        metadata: {
          type: "deployment",
          source: "deployments_step4.json",
          service: dep.service,
          version: dep.version,
          timestamp: dep.timestamp,
          is_breaking_change: dep.is_breaking_change || false,
          doc_id: `deployment_${idx}`,
        },
      }),
  );
}

// ─── Reciprocal Rank Fusion ─────────────────────────────────────────────

function reciprocalRankFusion(
  vectorResults: Array<{ doc: Document; score: number }>,
  keywordResults: Array<{ doc: Document; score: number }>,
  k: number = 60,
  limit: number = 10,
): Array<{ doc: Document; score: number }> {
  const rrfScores = new Map<string, number>();

  const getSourceWeight = (doc: Document): number => {
    switch (doc.metadata.type) {
      case "log":
        return 1.4;
      case "deployment":
        return 1.2;
      case "ticket":
        return 1.0;
      case "runbook":
        return 0.8;
      default:
        return 1.0;
    }
  };

  // Compute RRF scores from vector results
  vectorResults.forEach(({ doc }, rank) => {
    const docId = doc.metadata.doc_id || doc.pageContent;
    const score = getSourceWeight(doc) * (1 / (k + rank + 1));
    rrfScores.set(docId, (rrfScores.get(docId) || 0) + score);
  });

  // Compute RRF scores from keyword results
  keywordResults.forEach(({ doc }, rank) => {
    const docId = doc.metadata.doc_id || doc.pageContent;
    const score = getSourceWeight(doc) * (1 / (k + rank + 1));
    rrfScores.set(docId, (rrfScores.get(docId) || 0) + score);
  });

  // Create merged result set
  const allDocs = new Map<string, Document>();
  vectorResults.forEach(({ doc }) => {
    allDocs.set(doc.metadata.doc_id || doc.pageContent, doc);
  });
  keywordResults.forEach(({ doc }) => {
    allDocs.set(doc.metadata.doc_id || doc.pageContent, doc);
  });

  // Sort by RRF score
  const sorted = Array.from(rrfScores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([docId, score]) => ({
      doc: allDocs.get(docId)!,
      score,
    }));

  return sorted;
}

// ─── Hybrid Retriever ───────────────────────────────────────────────────

class HybridRetriever {
  private bm25Retriever: BM25Retriever | null = null;
  private vectorStore: VectorEntry[] = [];
  private allDocuments: Document[] = [];

  async initialize(): Promise<void> {
    console.log("Loading Phase 1 data...");

    // Load all documents
    this.allDocuments = [
      ...loadLogs(),
      ...loadTickets(),
      ...loadRunbooks(),
      ...loadDeployments(),
    ];

    console.log(`  Total documents: ${this.allDocuments.length}`);

    // Initialize BM25 retriever
    console.log("Initializing BM25 retriever...");
    this.bm25Retriever = await BM25Retriever.fromDocuments(
      this.allDocuments,
      { k: 10 },
    );
    console.log("  ✓ BM25 retriever ready");

    // Initialize vector store (embeddings)
    console.log("Generating embeddings for vector search...");
    let processed = 0;
    for (const doc of this.allDocuments) {
      try {
        const embedding = await embeddings.embedQuery(doc.pageContent);
        this.vectorStore.push({ doc, embedding });
        processed++;
        if (processed % 100 === 0) {
          console.log(`  ✓ Processed ${processed}/${this.allDocuments.length} documents`);
        }
      } catch (err) {
        console.warn(`  ⚠ Failed to embed doc ${processed}:`, err);
      }
    }
    console.log(`  ✓ Vector store ready (${this.vectorStore.length} embeddings)`);
  }

  async search(query: string, topK: number = 10): Promise<HybridSearchResult[]> {
    if (!this.bm25Retriever || !this.vectorStore.length) {
      throw new Error("Retrievers not initialized. Call initialize() first.");
    }

    console.log(`\nSearching for: "${query}"`);

    // Vector search
    console.log("  Running vector search...");
    const queryEmbedding = await embeddings.embedQuery(query);
    const vectorResults = this.vectorStore
      .map((entry) => ({
        doc: entry.doc,
        score: cosineSimilarity(queryEmbedding, entry.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
    console.log(`    ✓ Found ${vectorResults.length} vector results`);

    // Keyword search
    console.log("  Running keyword search...");
    const keywordResults = (await this.bm25Retriever._getRelevantDocuments(query)) as Document[];
    const keywordWithScore = keywordResults.map((doc: Document, idx) => ({
      doc,
      score: 1 / (idx + 1),
    }));
    console.log(`    ✓ Found ${keywordResults.length} keyword results`);

    // Fusion via RRF
    console.log("  Fusing results with RRF...");
    const fusedResults = reciprocalRankFusion(vectorResults, keywordWithScore, 60, topK);
    console.log(`    ✓ Fused into ${fusedResults.length} results`);

    // Format results
    return fusedResults.map(({ doc, score }) => ({
      content: doc.pageContent.substring(0, 200),
      score,
      source: doc.metadata.source,
      service: doc.metadata.service,
      timestamp: doc.metadata.timestamp,
      metadata: doc.metadata,
    }));
  }

  async search_with_filter(
    query: string,
    filter: { service?: string; type?: string; timestamp_after?: string },
    topK: number = 10,
  ): Promise<HybridSearchResult[]> {
    if (!this.bm25Retriever || !this.vectorStore.length) {
      throw new Error("Retrievers not initialized. Call initialize() first.");
    }

    // Filter documents
    let filtered = this.allDocuments;

    if (filter.service) {
      filtered = filtered.filter((d) => d.metadata.service === filter.service);
    }
    if (filter.type) {
      filtered = filtered.filter((d) => d.metadata.type === filter.type);
    }
    if (filter.timestamp_after) {
      filtered = filtered.filter(
        (d) => (d.metadata.timestamp || "") >= filter.timestamp_after!,
      );
    }

    console.log(`\nSearching (filtered ${filtered.length} docs): "${query}"`);

    // Vector search on filtered
    const queryEmbedding = await embeddings.embedQuery(query);
    const vectorResults = this.vectorStore
      .filter((entry) =>
        filtered.some((d) => d.metadata.doc_id === entry.doc.metadata.doc_id),
      )
      .map((entry) => ({
        doc: entry.doc,
        score: cosineSimilarity(queryEmbedding, entry.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    // Keyword search on filtered
    const keywordResults = (await this.bm25Retriever._getRelevantDocuments(query)) as Document[];
    const keywordFiltered = keywordResults.filter((doc: Document) =>
      filtered.some((d) => d.metadata.doc_id === doc.metadata.doc_id),
    );
    const keywordWithScore = keywordFiltered.map((doc: Document, idx) => ({
      doc,
      score: 1 / (idx + 1),
    }));

    const fusedResults = reciprocalRankFusion(vectorResults, keywordWithScore, 60, topK);

    return fusedResults.map(({ doc, score }) => ({
      content: doc.pageContent.substring(0, 200),
      score,
      source: doc.metadata.source,
      service: doc.metadata.service,
      timestamp: doc.metadata.timestamp,
      metadata: doc.metadata,
    }));
  }
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("Hybrid RAG System - Phase 2 Implementation\n");

  const retriever = new HybridRetriever();

  try {
    await retriever.initialize();

    // Ensure output directory exists
    if (!fs.existsSync(PHASE2_OUTPUT_DIR)) {
      fs.mkdirSync(PHASE2_OUTPUT_DIR, { recursive: true });
    }

    // Example queries
    const queries = [
      "users cannot log in",
      "auth-service deployment",
      "payment timeout",
      "orders failing",
    ];

    const allQueryResults: Array<{ query: string; results: HybridSearchResult[] }> = [];

    // Run searches
    for (const query of queries) {
      const results = await retriever.search(query, 5);
      allQueryResults.push({ query, results });
      console.log("\nTop Results:");
      results.forEach((result, idx) => {
        console.log(`  ${idx + 1}. [${result.source}] (score: ${result.score.toFixed(3)})`);
        console.log(`     ${result.content}...`);
      });
    }

    // Filtered search example
    console.log("\n" + "=".repeat(80));
    console.log("Filtered Search Example (service=auth-service)");
    const filteredResults = await retriever.search_with_filter(
      "token validation error",
      { service: "auth-service" },
      5,
    );
    console.log("\nFiltered Results:");
    filteredResults.forEach((result, idx) => {
      console.log(`  ${idx + 1}. [${result.source}] (score: ${result.score.toFixed(3)})`);
      console.log(`     ${result.content}...`);
    });

    // Save results to phase2 output
    const output = {
      generated_at: new Date().toISOString(),
      total_documents_indexed: 668,
      retrieval_method: "hybrid (BM25 + cosine similarity via nomic-embed-text, fused with RRF)",
      query_results: allQueryResults,
      filtered_result: {
        query: "token validation error",
        filter: { service: "auth-service" },
        results: filteredResults,
      },
    };

    const outputPath = path.join(PHASE2_OUTPUT_DIR, "hybrid_rag_results.json");
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`\n✓ Results saved to ${outputPath}`);

  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

main();
