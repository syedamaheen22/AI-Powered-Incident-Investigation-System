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
  score?: number;
}

type Strategy = 'vector_only' | 'hybrid';
type Mode = 'without_rerank' | 'with_rerank';

interface VariantResult {
  ids: string[];
  hit_at_5: boolean;
  answer: string;
  answer_correct: boolean;
  citation_accurate: boolean;
  cited_ids: string[];
}

interface PerQuestionResult {
  question_id: string;
  source: string;
  type: string;
  question: string;
  vector_only: Record<Mode, VariantResult>;
  hybrid: Record<Mode, VariantResult>;
}

interface SummaryMetrics {
  hit_rate_at_5: number;
  answer_correct_rate: number;
  citation_accuracy_rate: number;
}

interface RunOutput {
  run_date: string;
  llm_model: string;
  embedding_model: string;
  top_k: number;
  rerank_pool: number;
  retrieval_strategies: Strategy[];
  summary: {
    vector_only_without_rerank: SummaryMetrics;
    vector_only_with_rerank: SummaryMetrics;
    hybrid_without_rerank: SummaryMetrics;
    hybrid_with_rerank: SummaryMetrics;
  };
  examples_hybrid_improved: Array<{
    question_id: string;
    question: string;
    vector_ids: string[];
    hybrid_ids: string[];
  }>;
  examples_rerank_changed_answer: Array<{
    question_id: string;
    question: string;
    strategy: Strategy;
    answer_before: string;
    answer_after: string;
    correct_before: boolean;
    correct_after: boolean;
  }>;
  per_question: PerQuestionResult[];
}

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
const LLM_MODEL = process.env.RAG_LLM_MODEL ?? process.env.OLLAMA_MODEL ?? 'llama3';
const EMBED_MODEL = process.env.RAG_EMBED_MODEL ?? 'nomic-embed-text';

const CHROMA_HOST = process.env.CHROMA_HOST ?? '127.0.0.1';
const CHROMA_PORT = Number(process.env.CHROMA_PORT ?? '8000');

const TOP_K = Number(process.env.DAY8_TOP_K ?? '5');
const RERANK_POOL = Number(process.env.DAY8_RERANK_POOL ?? '15');
const CHUNK_WORDS = Number(process.env.DAY8_CHUNK_WORDS ?? '170');
const CHUNK_OVERLAP_WORDS = Number(process.env.DAY8_CHUNK_OVERLAP_WORDS ?? '40');

const TEST_SET_PATH = resolve(process.cwd(), 'docs', 'day3', 'pdf-test-set.json');
const JPM_PAGES_PATH = resolve(process.cwd(), 'data', 'pdfs', 'JPM-pages.json');
const JNJ_PAGES_PATH = resolve(process.cwd(), 'data', 'pdfs', 'JNJ-pages.json');

const OUT_DIR = resolve(process.cwd(), 'docs', 'day8');
const OUT_JSON = resolve(OUT_DIR, 'day8-retrieval-rerank-results.json');
const OUT_MD = resolve(OUT_DIR, 'DAY8_RETRIEVAL_RERANK_REPORT.md');

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

async function callOllamaGenerate(prompt: string, numPredict = 220): Promise<string> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: LLM_MODEL,
      prompt,
      stream: false,
      options: { temperature: 0, num_predict: numPredict },
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

function toRetrievedDocs(result: {
  ids?: string[][];
  documents?: Array<Array<string | null>>;
  metadatas?: Array<Array<Metadata | null>>;
  distances?: Array<Array<number | null>>;
}): RetrievedDoc[] {
  const ids = result.ids?.[0] ?? [];
  const docs = result.documents?.[0] ?? [];
  const metas = result.metadatas?.[0] ?? [];
  const distances = result.distances?.[0] ?? [];

  const out: RetrievedDoc[] = [];
  for (let i = 0; i < docs.length; i += 1) {
    const id = ids[i];
    const text = docs[i];
    const md = metas[i];
    if (!id || !text || !md) continue;

    const distance = distances[i];
    const converted: RetrievedDoc = {
      id,
      text,
      metadata: {
        source: String(md.source ?? 'UNKNOWN'),
        page: Number(md.page ?? 0),
        section: String(md.section ?? 'general'),
        date: String(md.date ?? '2024-12-31'),
      },
    };

    if (typeof distance === 'number') {
      converted.score = -distance;
    }

    out.push(converted);
  }

  return out;
}

function tokenize(text: string): string[] {
  const stop = new Set([
    'the',
    'a',
    'an',
    'of',
    'to',
    'in',
    'and',
    'for',
    'on',
    'at',
    'with',
    'from',
    'by',
    'is',
    'are',
    'was',
    'were',
    'what',
    'which',
    'how',
  ]);

  return normalize(text)
    .split(/\s+/)
    .filter((t) => t.length > 2 && !stop.has(t));
}

function lexicalRetrieve(chunks: DocChunk[], question: string, source: string, n: number): RetrievedDoc[] {
  const qTokens = new Set(tokenize(question));
  const scored: RetrievedDoc[] = [];

  for (const c of chunks) {
    if (source !== 'NONE' && c.metadata.source !== source) continue;

    const t = normalize(c.text);
    let overlap = 0;
    for (const tok of qTokens) {
      if (t.includes(tok)) overlap += 1;
    }

    if (overlap > 0) {
      scored.push({ id: c.id, text: c.text, metadata: c.metadata, score: overlap });
    }
  }

  scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return scored.slice(0, n);
}

function rrfFuse(lists: RetrievedDoc[][], topK: number): RetrievedDoc[] {
  const k = 60;
  const score = new Map<string, number>();
  const byId = new Map<string, RetrievedDoc>();

  for (const docs of lists) {
    for (let i = 0; i < docs.length; i += 1) {
      const d = docs[i];
      if (!d) continue;
      byId.set(d.id, d);
      score.set(d.id, (score.get(d.id) ?? 0) + 1 / (k + i + 1));
    }
  }

  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, s]) => ({ ...(byId.get(id) as RetrievedDoc), score: s }))
    .slice(0, topK);
}

function tokenOverlapScore(question: string, doc: string): number {
  const q = new Set(tokenize(question));
  const d = new Set(tokenize(doc));
  let overlap = 0;
  for (const t of q) if (d.has(t)) overlap += 1;
  return overlap;
}

async function rerankDocs(question: string, docs: RetrievedDoc[]): Promise<RetrievedDoc[]> {
  const shortlist = docs.slice(0, RERANK_POOL);
  if (shortlist.length <= 1) return shortlist;

  const context = shortlist.map((d, i) => `${i + 1}. id=${d.id}\ntext=${d.text.slice(0, 500)}`).join('\n\n');

  const prompt = [
    'Score each candidate for relevance to the question.',
    'Return JSON only in this format: {"scores":[{"id":"...","score":0-100}]}',
    'No prose.',
    '',
    `Question: ${question}`,
    '',
    context,
    '',
    'JSON:',
  ].join('\n');

  const raw = await callOllamaGenerate(prompt, 260);
  const llmScore = new Map<string, number>();

  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    const jsonText = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
    const parsed = JSON.parse(jsonText) as { scores?: Array<{ id: string; score: number }> };
    for (const row of parsed.scores ?? []) {
      if (!row?.id) continue;
      llmScore.set(String(row.id), Number(row.score ?? 0));
    }
  } catch {
    for (const d of shortlist) {
      llmScore.set(d.id, tokenOverlapScore(question, d.text) * 10);
    }
  }

  return shortlist
    .map((d) => ({ ...d, score: llmScore.get(d.id) ?? tokenOverlapScore(question, d.text) * 10 }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

async function generateAnswer(question: string, docs: RetrievedDoc[]): Promise<string> {
  const context = docs
    .slice(0, 3)
    .map((d) => `[${d.id}] ${d.text.slice(0, 700)}`)
    .join('\n\n');

  if (!context) return 'Insufficient context.';

  const prompt = [
    'Answer using only the provided context.',
    'If answer is not supported by context, say exactly: Insufficient context.',
    'Keep answer concise and cite supporting chunk ids in brackets, e.g. [JPM-p10-c2].',
    '',
    `Question: ${question}`,
    '',
    'Context:',
    context,
    '',
    'Answer:',
  ].join('\n');

  return callOllamaGenerate(prompt, 180);
}

function extractCitedIds(answer: string): string[] {
  const ids = new Set<string>();
  const re = /\[([A-Za-z0-9_-]+)\]/g;
  let m: RegExpExecArray | null = null;
  while ((m = re.exec(answer)) !== null) {
    if (m[1]) ids.add(m[1]);
  }
  return [...ids];
}

function parseExpectedPages(pageRef: string): number[] {
  const nums = (pageRef.match(/\d+/g) ?? []).map((x) => Number(x)).filter((n) => Number.isFinite(n));
  return [...new Set(nums)];
}

function hasKeywordHit(texts: string[], keywords: string[]): boolean {
  if (keywords.length === 0 || texts.length === 0) return false;
  const hay = normalize(texts.join(' '));
  return keywords.some((kw) => {
    const needle = normalize(kw);
    return needle.length > 0 && hay.includes(needle);
  });
}

function answerCorrect(q: QuestionEntry, answer: string): boolean {
  if (q.type === 'unanswerable') {
    const a = normalize(answer);
    return a.includes('insufficient context') || a.includes('cannot be determined') || a.includes('not available');
  }
  return hasKeywordHit([answer], q.keywords);
}

function citationAccurate(q: QuestionEntry, answer: string, docs: RetrievedDoc[]): { accurate: boolean; cited: string[] } {
  const cited = extractCitedIds(answer);
  if (q.type === 'unanswerable') return { accurate: cited.length === 0, cited };

  const byId = new Map(docs.map((d) => [d.id, d]));
  const expectedPages = parseExpectedPages(q.page_ref);

  if (cited.length === 0) return { accurate: false, cited };

  for (const id of cited) {
    const d = byId.get(id);
    if (!d) continue;
    if (q.source !== 'NONE' && d.metadata.source !== q.source) continue;
    if (expectedPages.length === 0 || expectedPages.includes(d.metadata.page)) {
      return { accurate: true, cited };
    }
  }

  return { accurate: false, cited };
}

async function recreateCollection(chroma: ChromaClient, name: string): Promise<void> {
  try {
    await chroma.deleteCollection({ name });
  } catch {
    // Collection may not exist.
  }
  await chroma.getOrCreateCollection({ name, embeddingFunction: null });
}

async function retrieveVector(
  collection: Awaited<ReturnType<ChromaClient['getCollection']>>,
  q: QuestionEntry,
  nResults: number,
): Promise<RetrievedDoc[]> {
  const emb = await callOllamaEmbedding(q.question);

  const queryArgs: {
    queryEmbeddings: number[][];
    nResults: number;
    where?: { source: string };
  } = {
    queryEmbeddings: [emb],
    nResults,
  };

  if (q.source !== 'NONE') queryArgs.where = { source: q.source };
  const result = await collection.query(queryArgs);
  return toRetrievedDocs(result);
}

async function retrieveHybrid(
  collection: Awaited<ReturnType<ChromaClient['getCollection']>>,
  chunks: DocChunk[],
  q: QuestionEntry,
  nResults: number,
): Promise<RetrievedDoc[]> {
  const vectorDocs = await retrieveVector(collection, q, nResults);
  const lexicalDocs = lexicalRetrieve(chunks, q.question, q.source, nResults);
  return rrfFuse([vectorDocs, lexicalDocs], nResults);
}

function summarize(rows: PerQuestionResult[], strategy: Strategy, mode: Mode): SummaryMetrics {
  const chosen = rows.map((r) => (strategy === 'vector_only' ? r.vector_only[mode] : r.hybrid[mode]));
  const total = chosen.length || 1;

  const hit = chosen.filter((x) => x.hit_at_5).length;
  const ans = chosen.filter((x) => x.answer_correct).length;
  const cit = chosen.filter((x) => x.citation_accurate).length;

  return {
    hit_rate_at_5: Number((hit / total).toFixed(3)),
    answer_correct_rate: Number((ans / total).toFixed(3)),
    citation_accuracy_rate: Number((cit / total).toFixed(3)),
  };
}

function buildMarkdown(output: RunOutput): string {
  const s = output.summary;

  const hybridExamples =
    output.examples_hybrid_improved.length === 0
      ? '- None found in this run.'
      : output.examples_hybrid_improved
          .map(
            (e) =>
              `- ${e.question_id}: ${e.question}\n  - vector ids: ${e.vector_ids.join(', ') || 'none'}\n  - hybrid ids: ${e.hybrid_ids.join(', ') || 'none'}`,
          )
          .join('\n');

  const rerankExamples =
    output.examples_rerank_changed_answer.length === 0
      ? '- None found in this run.'
      : output.examples_rerank_changed_answer
          .map(
            (e) =>
              `- ${e.question_id} (${e.strategy})\n  - Q: ${e.question}\n  - before: ${e.answer_before}\n  - after: ${e.answer_after}\n  - correctness: ${e.correct_before} -> ${e.correct_after}`,
          )
          .join('\n');

  return [
    '# Day 8 Retrieval Strategy + Reranking Comparison',
    '',
    `- Run date: ${output.run_date}`,
    `- LLM model: ${output.llm_model}`,
    `- Embedding model: ${output.embedding_model}`,
    `- Retrieval top-k: ${output.top_k}`,
    `- Rerank pool size: ${output.rerank_pool}`,
    '',
    '## Comparison tables',
    '',
    '### hit-rate@5 (vector vs hybrid retrieval)',
    '',
    '| Setup | Vector-only | Hybrid |',
    '|---|---:|---:|',
    `| Without reranking | ${(s.vector_only_without_rerank.hit_rate_at_5 * 100).toFixed(1)}% | ${(s.hybrid_without_rerank.hit_rate_at_5 * 100).toFixed(1)}% |`,
    `| With reranking | ${(s.vector_only_with_rerank.hit_rate_at_5 * 100).toFixed(1)}% | ${(s.hybrid_with_rerank.hit_rate_at_5 * 100).toFixed(1)}% |`,
    '',
    '### answer correctness before vs after reranking',
    '',
    '| Strategy | Before reranking | After reranking |',
    '|---|---:|---:|',
    `| Vector-only | ${(s.vector_only_without_rerank.answer_correct_rate * 100).toFixed(1)}% | ${(s.vector_only_with_rerank.answer_correct_rate * 100).toFixed(1)}% |`,
    `| Hybrid | ${(s.hybrid_without_rerank.answer_correct_rate * 100).toFixed(1)}% | ${(s.hybrid_with_rerank.answer_correct_rate * 100).toFixed(1)}% |`,
    '',
    '### citation accuracy before vs after reranking',
    '',
    '| Strategy | Before reranking | After reranking |',
    '|---|---:|---:|',
    `| Vector-only | ${(s.vector_only_without_rerank.citation_accuracy_rate * 100).toFixed(1)}% | ${(s.vector_only_with_rerank.citation_accuracy_rate * 100).toFixed(1)}% |`,
    `| Hybrid | ${(s.hybrid_without_rerank.citation_accuracy_rate * 100).toFixed(1)}% | ${(s.hybrid_with_rerank.citation_accuracy_rate * 100).toFixed(1)}% |`,
    '',
    '## Analysis',
    '',
    '### 5 examples where hybrid retrieval improved results',
    '',
    hybridExamples,
    '',
    '### 5 examples where reranking changed the final answer',
    '',
    rerankExamples,
    '',
    '## Notes',
    '',
    '- Vector-only retrieval: embedding similarity against Chroma.',
    '- Hybrid retrieval: reciprocal rank fusion of vector and lexical retrieval.',
    '- Reranking: LLM relevance scoring on retrieved candidates before final top-k selection.',
  ].join('\n');
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  const testSet = JSON.parse(readFileSync(TEST_SET_PATH, 'utf-8')) as TestSet;
  const jpmPages = JSON.parse(readFileSync(JPM_PAGES_PATH, 'utf-8')) as PageCorpus;
  const jnjPages = JSON.parse(readFileSync(JNJ_PAGES_PATH, 'utf-8')) as PageCorpus;

  const allChunks = [...buildChunksFromPages(jpmPages), ...buildChunksFromPages(jnjPages)];
  console.log(`Prepared chunks: ${allChunks.length}`);

  const chroma = new ChromaClient({ host: CHROMA_HOST, port: CHROMA_PORT, ssl: false });
  const collectionName = 'day8_retrieval_rerank_eval';

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

  const rows: PerQuestionResult[] = [];

  console.log(`Running ${testSet.questions.length} questions...`);
  for (const q of testSet.questions) {
    process.stdout.write(`  ${q.id}... `);

    const vectorPool = await retrieveVector(collection, q, RERANK_POOL);
    const hybridPool = await retrieveHybrid(collection, allChunks, q, RERANK_POOL);

    const vecWithout = vectorPool.slice(0, TOP_K);
    const hybWithout = hybridPool.slice(0, TOP_K);

    const vecWith = (await rerankDocs(q.question, vectorPool)).slice(0, TOP_K);
    const hybWith = (await rerankDocs(q.question, hybridPool)).slice(0, TOP_K);

    const vecWithoutAnswer = await generateAnswer(q.question, vecWithout);
    const vecWithAnswer = await generateAnswer(q.question, vecWith);
    const hybWithoutAnswer = await generateAnswer(q.question, hybWithout);
    const hybWithAnswer = await generateAnswer(q.question, hybWith);

    const vecWithoutCit = citationAccurate(q, vecWithoutAnswer, vecWithout);
    const vecWithCit = citationAccurate(q, vecWithAnswer, vecWith);
    const hybWithoutCit = citationAccurate(q, hybWithoutAnswer, hybWithout);
    const hybWithCit = citationAccurate(q, hybWithAnswer, hybWith);

    rows.push({
      question_id: q.id,
      source: q.source,
      type: q.type,
      question: q.question,
      vector_only: {
        without_rerank: {
          ids: vecWithout.map((d) => d.id),
          hit_at_5: hasKeywordHit(vecWithout.map((d) => d.text), q.keywords),
          answer: vecWithoutAnswer,
          answer_correct: answerCorrect(q, vecWithoutAnswer),
          citation_accurate: vecWithoutCit.accurate,
          cited_ids: vecWithoutCit.cited,
        },
        with_rerank: {
          ids: vecWith.map((d) => d.id),
          hit_at_5: hasKeywordHit(vecWith.map((d) => d.text), q.keywords),
          answer: vecWithAnswer,
          answer_correct: answerCorrect(q, vecWithAnswer),
          citation_accurate: vecWithCit.accurate,
          cited_ids: vecWithCit.cited,
        },
      },
      hybrid: {
        without_rerank: {
          ids: hybWithout.map((d) => d.id),
          hit_at_5: hasKeywordHit(hybWithout.map((d) => d.text), q.keywords),
          answer: hybWithoutAnswer,
          answer_correct: answerCorrect(q, hybWithoutAnswer),
          citation_accurate: hybWithoutCit.accurate,
          cited_ids: hybWithoutCit.cited,
        },
        with_rerank: {
          ids: hybWith.map((d) => d.id),
          hit_at_5: hasKeywordHit(hybWith.map((d) => d.text), q.keywords),
          answer: hybWithAnswer,
          answer_correct: answerCorrect(q, hybWithAnswer),
          citation_accurate: hybWithCit.accurate,
          cited_ids: hybWithCit.cited,
        },
      },
    });

    console.log('done');
  }

  const examplesHybridImproved = rows
    .filter((r) => !r.vector_only.without_rerank.hit_at_5 && r.hybrid.without_rerank.hit_at_5)
    .slice(0, 5)
    .map((r) => ({
      question_id: r.question_id,
      question: r.question,
      vector_ids: r.vector_only.without_rerank.ids,
      hybrid_ids: r.hybrid.without_rerank.ids,
    }));

  const examplesRerankChangedAnswer = rows
    .flatMap((r) => {
      const out: RunOutput['examples_rerank_changed_answer'] = [];

      if (normalize(r.vector_only.without_rerank.answer) !== normalize(r.vector_only.with_rerank.answer)) {
        out.push({
          question_id: r.question_id,
          question: r.question,
          strategy: 'vector_only',
          answer_before: r.vector_only.without_rerank.answer,
          answer_after: r.vector_only.with_rerank.answer,
          correct_before: r.vector_only.without_rerank.answer_correct,
          correct_after: r.vector_only.with_rerank.answer_correct,
        });
      }

      if (normalize(r.hybrid.without_rerank.answer) !== normalize(r.hybrid.with_rerank.answer)) {
        out.push({
          question_id: r.question_id,
          question: r.question,
          strategy: 'hybrid',
          answer_before: r.hybrid.without_rerank.answer,
          answer_after: r.hybrid.with_rerank.answer,
          correct_before: r.hybrid.without_rerank.answer_correct,
          correct_after: r.hybrid.with_rerank.answer_correct,
        });
      }

      return out;
    })
    .slice(0, 5);

  const output: RunOutput = {
    run_date: new Date().toISOString(),
    llm_model: LLM_MODEL,
    embedding_model: EMBED_MODEL,
    top_k: TOP_K,
    rerank_pool: RERANK_POOL,
    retrieval_strategies: ['vector_only', 'hybrid'],
    summary: {
      vector_only_without_rerank: summarize(rows, 'vector_only', 'without_rerank'),
      vector_only_with_rerank: summarize(rows, 'vector_only', 'with_rerank'),
      hybrid_without_rerank: summarize(rows, 'hybrid', 'without_rerank'),
      hybrid_with_rerank: summarize(rows, 'hybrid', 'with_rerank'),
    },
    examples_hybrid_improved: examplesHybridImproved,
    examples_rerank_changed_answer: examplesRerankChangedAnswer,
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
