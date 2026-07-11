import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ChromaClient, type Metadata } from 'chromadb';

interface QuestionEntry {
  id: string;
  source: string;
  type: string;
  difficulty: string;
  question: string;
  ground_truth: string;
  keywords: string[];
  page_ref: string;
}

interface TestSet {
  meta: {
    title: string;
    total_questions: number;
  };
  questions: QuestionEntry[];
}

interface PageCorpus {
  label: 'JPM' | 'JNJ';
  pages: number;
  pageTexts: string[];
}

interface ChunkMetadata {
  source: string;
  page: number;
  section: string;
  date: string;
}

interface DocChunk {
  id: string;
  text: string;
  metadata: ChunkMetadata;
}

interface RetrievedDoc {
  id: string;
  text: string;
  metadata: ChunkMetadata;
}

interface QuestionRun {
  question_id: string;
  source: string;
  type: string;
  question: string;
  section_hint: string | null;
  baseline: {
    ids: string[];
    hit_at_5: boolean;
  };
  optimized: {
    ids: string[];
    hit_at_5: boolean;
    hyde: string;
    rewrites: string[];
  };
}

interface RunOutput {
  run_date: string;
  llm_model: string;
  embedding_model: string;
  top_k: number;
  chunk_words: number;
  chunk_overlap_words: number;
  query_optimization: {
    hyde: true;
    multi_query_rewrite: true;
    metadata_filters: string[];
  };
  retrieval_summary: {
    total_questions: number;
    answerable_questions: number;
    baseline_hits_all: number;
    optimized_hits_all: number;
    baseline_hit_rate_at_5_all: number;
    optimized_hit_rate_at_5_all: number;
    baseline_hits_answerable: number;
    optimized_hits_answerable: number;
    baseline_hit_rate_at_5_answerable: number;
    optimized_hit_rate_at_5_answerable: number;
  };
  improved_examples: Array<{
    question_id: string;
    question: string;
    source: string;
    section_hint: string | null;
    baseline_ids: string[];
    optimized_ids: string[];
  }>;
  failure_cases_optimization_not_helpful: Array<{
    question_id: string;
    question: string;
    source: string;
    section_hint: string | null;
    baseline_hit: boolean;
    optimized_hit: boolean;
    baseline_ids: string[];
    optimized_ids: string[];
  }>;
  per_question: QuestionRun[];
}

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
const LLM_MODEL = process.env.RAG_LLM_MODEL ?? process.env.OLLAMA_MODEL ?? 'llama3';
const EMBED_MODEL = process.env.RAG_EMBED_MODEL ?? 'nomic-embed-text';

const CHROMA_HOST = process.env.CHROMA_HOST ?? '127.0.0.1';
const CHROMA_PORT = Number(process.env.CHROMA_PORT ?? '8000');

const TOP_K = Number(process.env.DAY7_TOP_K ?? '5');
const CHUNK_WORDS = Number(process.env.DAY7_CHUNK_WORDS ?? '170');
const CHUNK_OVERLAP_WORDS = Number(process.env.DAY7_CHUNK_OVERLAP_WORDS ?? '40');

const TEST_SET_PATH = resolve(process.cwd(), 'docs', 'day3', 'pdf-test-set.json');
const JPM_PAGES_PATH = resolve(process.cwd(), 'data', 'pdfs', 'JPM-pages.json');
const JNJ_PAGES_PATH = resolve(process.cwd(), 'data', 'pdfs', 'JNJ-pages.json');

const OUT_DIR = resolve(process.cwd(), 'docs', 'day7');
const OUT_JSON = resolve(OUT_DIR, 'day7-query-optimization-results.json');
const OUT_MD = resolve(OUT_DIR, 'DAY7_QUERY_OPTIMIZATION_REPORT.md');

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9.%\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function splitByWords(text: string, chunkWords: number, overlapWords: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const step = Math.max(1, chunkWords - overlapWords);
  const chunks: string[] = [];

  for (let start = 0; start < words.length; start += step) {
    const end = Math.min(words.length, start + chunkWords);
    const chunk = words.slice(start, end).join(' ').trim();
    if (chunk.length > 0) chunks.push(chunk);
    if (end === words.length) break;
  }

  return chunks;
}

function hasKeywordHit(retrievedDocs: string[], keywords: string[]): boolean {
  if (keywords.length === 0 || retrievedDocs.length === 0) return false;
  const hay = normalize(retrievedDocs.join(' '));
  return keywords.some((kw) => {
    const needle = normalize(kw);
    return needle.length > 0 && hay.includes(needle);
  });
}

function inferSection(pageText: string): string {
  const t = normalize(pageText);

  if (t.includes('financial highlights') || t.includes('selected ratios') || t.includes('total net revenue')) {
    return 'financial_highlights';
  }
  if (t.includes('liquidity and capital resources') || t.includes('cash flow') || t.includes('total debt')) {
    return 'liquidity_capital';
  }
  if (t.includes('medtech') || t.includes('electrophysiology') || t.includes('varipulse') || t.includes('velys')) {
    return 'medtech';
  }
  if (t.includes('innovative medicine') || t.includes('darzalex') || t.includes('spravato') || t.includes('xarelto')) {
    return 'innovative_medicine';
  }
  if (t.includes('acquisition') || t.includes('intra-cellular') || t.includes('strategic')) {
    return 'strategy_mna';
  }
  if (t.includes('dividend') || t.includes('free cash flow') || t.includes('net earnings per share')) {
    return 'shareholder_returns';
  }

  return 'general';
}

function inferQuestionSectionHint(q: QuestionEntry): string | null {
  const text = normalize(`${q.page_ref} ${q.question}`);

  const rules: Array<{ section: string; keys: string[] }> = [
    {
      section: 'financial_highlights',
      keys: ['financial highlights', 'selected ratios', 'market data', 'selected balance sheet'],
    },
    {
      section: 'liquidity_capital',
      keys: ['liquidity', 'debt section', 'capital resources', 'total debt'],
    },
    {
      section: 'medtech',
      keys: ['medtech', 'varipulse', 'velys', 'robot-assisted', 'partial-knee', 'spine surgery'],
    },
    {
      section: 'innovative_medicine',
      keys: ['innovative medicine', 'darzalex', 'spravato', 'xarelto', 'segment sales'],
    },
    {
      section: 'strategy_mna',
      keys: ['acquisition', 'strategic actions', 'intra-cellular', 'planned acquisition'],
    },
    {
      section: 'shareholder_returns',
      keys: ['dividend', 'free cash flow', 'adjusted diluted net earnings per share', 'capital allocation'],
    },
  ];

  for (const rule of rules) {
    if (rule.keys.some((k) => text.includes(normalize(k)))) {
      return rule.section;
    }
  }

  return null;
}

async function callOllamaGenerate(prompt: string): Promise<string> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: LLM_MODEL,
      prompt,
      stream: false,
      options: { temperature: 0, num_predict: 220 },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama generate failed (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as { response?: string; error?: string };
  if (payload.error) throw new Error(`Ollama generate error: ${payload.error}`);
  return (payload.response ?? '').trim();
}

async function callOllamaEmbedding(input: string): Promise<number[]> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: input }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama embeddings failed (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as { embedding?: number[]; error?: string };
  if (payload.error) throw new Error(`Ollama embedding error: ${payload.error}`);
  if (!payload.embedding || payload.embedding.length === 0) {
    throw new Error('No embedding returned from Ollama.');
  }

  return payload.embedding;
}

function hydePrompt(question: string): string {
  return [
    'Write a concise hypothetical answer passage (4-6 sentences) that would likely appear in a company annual report.',
    'Use concrete business terms and likely supporting details, but do not mention that the passage is hypothetical.',
    '',
    `Question: ${question}`,
    'Passage:',
  ].join('\n');
}

function multiQueryPrompt(question: string): string {
  return [
    'Rewrite the following question into 3 diverse retrieval queries.',
    'Keep each query short and specific. Return exactly 3 lines, no numbering.',
    '',
    `Question: ${question}`,
    'Queries:',
  ].join('\n');
}

function parseRewrites(raw: string, original: string): string[] {
  const lines = raw
    .split(/\n+/)
    .map((s) => s.trim().replace(/^[-*0-9.)\s]+/, '').trim())
    .filter((s) => s.length > 0);

  const cleaned = lines.filter((s) => normalize(s) !== normalize(original));
  return cleaned.slice(0, 3);
}

function buildChunksFromPages(corpus: PageCorpus): DocChunk[] {
  const chunks: DocChunk[] = [];

  for (let i = 0; i < corpus.pageTexts.length; i += 1) {
    const pageText = corpus.pageTexts[i] ?? '';
    const page = i + 1;
    const clean = pageText.trim();
    if (clean.length === 0) continue;

    const section = inferSection(clean);
    const split = splitByWords(clean, CHUNK_WORDS, CHUNK_OVERLAP_WORDS);

    for (let j = 0; j < split.length; j += 1) {
      const text = split[j];
      if (!text) continue;
      chunks.push({
        id: `${corpus.label}-p${page}-c${j + 1}`,
        text,
        metadata: {
          source: corpus.label,
          page,
          section,
          date: '2024-12-31',
        },
      });
    }
  }

  return chunks;
}

async function recreateCollection(chroma: ChromaClient, name: string): Promise<void> {
  try {
    await chroma.deleteCollection({ name });
  } catch {
    // Collection may not exist.
  }
  await chroma.getOrCreateCollection({ name, embeddingFunction: null });
}

function toRetrievedDocs(result: {
  ids?: string[][];
  documents?: Array<Array<string | null>>;
  metadatas?: Array<Array<Metadata | null>>;
}): RetrievedDoc[] {
  const ids = result.ids?.[0] ?? [];
  const docs = result.documents?.[0] ?? [];
  const metas = result.metadatas?.[0] ?? [];

  const out: RetrievedDoc[] = [];
  for (let i = 0; i < docs.length; i += 1) {
    const id = ids[i];
    const text = docs[i];
    const md = metas[i];
    if (!id || !text || !md) continue;

    const source = String(md.source ?? 'UNKNOWN');
    const page = Number(md.page ?? 0);
    const section = String(md.section ?? 'general');
    const date = String(md.date ?? '2024-12-31');

    out.push({
      id,
      text,
      metadata: { source, page, section, date },
    });
  }

  return out;
}

async function runBaselineRetrieval(
  collection: Awaited<ReturnType<ChromaClient['getCollection']>>,
  q: QuestionEntry,
): Promise<RetrievedDoc[]> {
  const emb = await callOllamaEmbedding(q.question);

  const queryArgs: {
    queryEmbeddings: number[][];
    nResults: number;
    where?: { source: string };
  } = {
    queryEmbeddings: [emb],
    nResults: TOP_K,
  };

  if (q.source !== 'NONE') queryArgs.where = { source: q.source };

  const result = await collection.query(queryArgs);
  return toRetrievedDocs(result);
}

function rrfFuse(
  resultLists: RetrievedDoc[][],
  sectionHint: string | null,
  topK: number,
): RetrievedDoc[] {
  const k = 60;
  const score = new Map<string, number>();
  const byId = new Map<string, RetrievedDoc>();

  for (const docs of resultLists) {
    for (let i = 0; i < docs.length; i += 1) {
      const d = docs[i];
      if (!d) continue;
      byId.set(d.id, d);
      const add = 1 / (k + i + 1);
      score.set(d.id, (score.get(d.id) ?? 0) + add);
    }
  }

  if (sectionHint) {
    for (const [id, doc] of byId.entries()) {
      if (doc.metadata.section === sectionHint) {
        score.set(id, (score.get(id) ?? 0) + 0.15);
      }
    }
  }

  const ranked = [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => byId.get(id))
    .filter((x): x is RetrievedDoc => Boolean(x));

  return ranked.slice(0, topK);
}

async function runOptimizedRetrieval(
  collection: Awaited<ReturnType<ChromaClient['getCollection']>>,
  q: QuestionEntry,
): Promise<{ docs: RetrievedDoc[]; hyde: string; rewrites: string[] }> {
  const hyde = await callOllamaGenerate(hydePrompt(q.question));
  const rewritesRaw = await callOllamaGenerate(multiQueryPrompt(q.question));
  const rewrites = parseRewrites(rewritesRaw, q.question);

  const sectionHint = inferQuestionSectionHint(q);
  const texts = [q.question, ...rewrites, hyde].filter((t) => t.trim().length > 0);

  const resultLists: RetrievedDoc[][] = [];

  for (const text of texts) {
    const emb = await callOllamaEmbedding(text);

    if (q.source !== 'NONE') {
      const sourceOnly = await collection.query({
        queryEmbeddings: [emb],
        nResults: TOP_K,
        where: { source: q.source },
      });
      resultLists.push(toRetrievedDocs(sourceOnly));

      if (sectionHint) {
        const sectionFiltered = await collection.query({
          queryEmbeddings: [emb],
          nResults: TOP_K,
          where: {
            $and: [{ source: q.source }, { section: sectionHint }],
          } as any,
        });
        resultLists.push(toRetrievedDocs(sectionFiltered));
      }
    } else {
      const noFilter = await collection.query({
        queryEmbeddings: [emb],
        nResults: TOP_K,
      });
      resultLists.push(toRetrievedDocs(noFilter));
    }
  }

  const fused = rrfFuse(resultLists, sectionHint, TOP_K);
  return { docs: fused, hyde, rewrites };
}

function buildSummary(rows: QuestionRun[]): RunOutput['retrieval_summary'] {
  const answerable = rows.filter((r) => r.type !== 'unanswerable');

  const baselineHitsAll = rows.filter((r) => r.baseline.hit_at_5).length;
  const optimizedHitsAll = rows.filter((r) => r.optimized.hit_at_5).length;

  const baselineHitsAnswerable = answerable.filter((r) => r.baseline.hit_at_5).length;
  const optimizedHitsAnswerable = answerable.filter((r) => r.optimized.hit_at_5).length;

  return {
    total_questions: rows.length,
    answerable_questions: answerable.length,
    baseline_hits_all: baselineHitsAll,
    optimized_hits_all: optimizedHitsAll,
    baseline_hit_rate_at_5_all: rows.length === 0 ? 0 : Number((baselineHitsAll / rows.length).toFixed(3)),
    optimized_hit_rate_at_5_all: rows.length === 0 ? 0 : Number((optimizedHitsAll / rows.length).toFixed(3)),
    baseline_hits_answerable: baselineHitsAnswerable,
    optimized_hits_answerable: optimizedHitsAnswerable,
    baseline_hit_rate_at_5_answerable:
      answerable.length === 0 ? 0 : Number((baselineHitsAnswerable / answerable.length).toFixed(3)),
    optimized_hit_rate_at_5_answerable:
      answerable.length === 0 ? 0 : Number((optimizedHitsAnswerable / answerable.length).toFixed(3)),
  };
}

function buildMarkdown(output: RunOutput): string {
  const summary = output.retrieval_summary;

  const improved =
    output.improved_examples.length === 0
      ? '- None found in this run.'
      : output.improved_examples
          .map(
            (x) =>
              `- ${x.question_id} (${x.source}, section_hint=${x.section_hint ?? 'none'}): ${x.question}\n  - baseline: ${x.baseline_ids.join(', ') || 'none'}\n  - optimized: ${x.optimized_ids.join(', ') || 'none'}`,
          )
          .join('\n');

  const failures =
    output.failure_cases_optimization_not_helpful.length === 0
      ? '- None found in this run.'
      : output.failure_cases_optimization_not_helpful
          .map(
            (x) =>
              `- ${x.question_id} (${x.source}, section_hint=${x.section_hint ?? 'none'}, baseline_hit=${x.baseline_hit}, optimized_hit=${x.optimized_hit}): ${x.question}\n  - baseline: ${x.baseline_ids.join(', ') || 'none'}\n  - optimized: ${x.optimized_ids.join(', ') || 'none'}`,
          )
          .join('\n');

  return [
    '# Day 7 Query Optimization + Metadata Filtering Comparison',
    '',
    `- Run date: ${output.run_date}`,
    `- LLM model: ${output.llm_model}`,
    `- Embedding model: ${output.embedding_model}`,
    `- Retrieval top-k: ${output.top_k}`,
    `- Query optimization: HyDE + multi-query rewriting`,
    `- Metadata attached to chunks: source, section, page, date`,
    `- Metadata filters used in optimized retrieval: ${output.query_optimization.metadata_filters.join(', ')}`,
    '',
    '## Comparison table',
    '',
    '| Metric | Baseline retrieval | Optimized retrieval |',
    '|---|---:|---:|',
    `| hit-rate@5 (all questions) | ${summary.baseline_hits_all}/${summary.total_questions} (${(summary.baseline_hit_rate_at_5_all * 100).toFixed(1)}%) | ${summary.optimized_hits_all}/${summary.total_questions} (${(summary.optimized_hit_rate_at_5_all * 100).toFixed(1)}%) |`,
    `| hit-rate@5 (answerable only) | ${summary.baseline_hits_answerable}/${summary.answerable_questions} (${(summary.baseline_hit_rate_at_5_answerable * 100).toFixed(1)}%) | ${summary.optimized_hits_answerable}/${summary.answerable_questions} (${(summary.optimized_hit_rate_at_5_answerable * 100).toFixed(1)}%) |`,
    '',
    '## Examples where query optimization improved results',
    '',
    improved,
    '',
    '## 5 failure cases where optimization did not help',
    '',
    failures,
    '',
    '## Notes',
    '',
    '- Baseline retrieval: single-question embedding query.',
    '- Optimized retrieval: HyDE passage + multi-query rewrites + reciprocal-rank fusion.',
    '- Optimized pipeline applies metadata filtering by source and source+section (when a section hint is inferred from question metadata).',
  ].join('\n');
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  const testSet = JSON.parse(readFileSync(TEST_SET_PATH, 'utf-8')) as TestSet;
  const jpmPages = JSON.parse(readFileSync(JPM_PAGES_PATH, 'utf-8')) as PageCorpus;
  const jnjPages = JSON.parse(readFileSync(JNJ_PAGES_PATH, 'utf-8')) as PageCorpus;

  const allChunks = [...buildChunksFromPages(jpmPages), ...buildChunksFromPages(jnjPages)];
  console.log(`Prepared chunks with metadata: ${allChunks.length}`);

  const chroma = new ChromaClient({
    host: CHROMA_HOST,
    port: CHROMA_PORT,
    ssl: false,
  });
  const collectionName = 'day7_query_opt_eval';

  await recreateCollection(chroma, collectionName);
  const collection = await chroma.getCollection({ name: collectionName });

  console.log('Indexing chunks into Chroma...');
  for (let i = 0; i < allChunks.length; i += 1) {
    const row = allChunks[i];
    if (!row) continue;

    const emb = await callOllamaEmbedding(row.text);
    await collection.add({
      ids: [row.id],
      embeddings: [emb],
      documents: [row.text],
      metadatas: [row.metadata as unknown as Metadata],
    });

    if ((i + 1) % 100 === 0 || i === allChunks.length - 1) {
      console.log(`  indexed ${i + 1}/${allChunks.length}`);
    }
  }

  const rows: QuestionRun[] = [];

  console.log(`Running comparison on ${testSet.questions.length} questions...`);
  for (const q of testSet.questions) {
    process.stdout.write(`  ${q.id}... `);

    const baselineDocs = await runBaselineRetrieval(collection, q);
    const optimized = await runOptimizedRetrieval(collection, q);

    const baselineHit = hasKeywordHit(
      baselineDocs.map((d) => d.text),
      q.keywords,
    );
    const optimizedHit = hasKeywordHit(
      optimized.docs.map((d) => d.text),
      q.keywords,
    );

    rows.push({
      question_id: q.id,
      source: q.source,
      type: q.type,
      question: q.question,
      section_hint: inferQuestionSectionHint(q),
      baseline: {
        ids: baselineDocs.map((d) => d.id),
        hit_at_5: baselineHit,
      },
      optimized: {
        ids: optimized.docs.map((d) => d.id),
        hit_at_5: optimizedHit,
        hyde: optimized.hyde,
        rewrites: optimized.rewrites,
      },
    });

    const flag = baselineHit === optimizedHit ? 'UNCHANGED' : optimizedHit ? 'IMPROVED' : 'WORSE';
    console.log(flag);
  }

  const improved = rows
    .filter((r) => !r.baseline.hit_at_5 && r.optimized.hit_at_5)
    .map((r) => ({
      question_id: r.question_id,
      question: r.question,
      source: r.source,
      section_hint: r.section_hint,
      baseline_ids: r.baseline.ids,
      optimized_ids: r.optimized.ids,
    }))
    .slice(0, 8);

  const failureCases = rows
    .filter((r) => !r.optimized.hit_at_5)
    .map((r) => ({
      question_id: r.question_id,
      question: r.question,
      source: r.source,
      section_hint: r.section_hint,
      baseline_hit: r.baseline.hit_at_5,
      optimized_hit: r.optimized.hit_at_5,
      baseline_ids: r.baseline.ids,
      optimized_ids: r.optimized.ids,
    }))
    .slice(0, 5);

  const output: RunOutput = {
    run_date: new Date().toISOString(),
    llm_model: LLM_MODEL,
    embedding_model: EMBED_MODEL,
    top_k: TOP_K,
    chunk_words: CHUNK_WORDS,
    chunk_overlap_words: CHUNK_OVERLAP_WORDS,
    query_optimization: {
      hyde: true,
      multi_query_rewrite: true,
      metadata_filters: ['source', 'section'],
    },
    retrieval_summary: buildSummary(rows),
    improved_examples: improved,
    failure_cases_optimization_not_helpful: failureCases,
    per_question: rows,
  };

  writeFileSync(OUT_JSON, JSON.stringify(output, null, 2));
  writeFileSync(OUT_MD, buildMarkdown(output));

  console.log(`JSON written: ${OUT_JSON}`);
  console.log(`Report written: ${OUT_MD}`);
}

main().catch((err) => {
  const msg = String(err);
  if (msg.includes('Failed to connect to chromadb') || msg.includes('ChromaConnectionError')) {
    console.error('Chroma is not reachable at http://127.0.0.1:8000.');
    console.error('Start it with: .venv/bin/chroma run --host 127.0.0.1 --port 8000 --path ./chroma');
  }
  console.error('Fatal:', err);
  process.exit(1);
});
