import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ChromaClient } from 'chromadb';

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

interface ChunkRecord {
  id: string;
  source: string;
  text: string;
}

type StrategyName = 'fixed_size' | 'overlapping' | 'recursive';

interface PerQuestionResult {
  question_id: string;
  question: string;
  source: string;
  type: string;
  strategy: StrategyName;
  retrieved_chunk_ids: string[];
  retrieved_text_preview: string[];
  hit_at_5: boolean;
}

interface StrategySummary {
  strategy: StrategyName;
  total_questions: number;
  answerable_questions: number;
  hits_at_5_total: number;
  hits_at_5_answerable: number;
  hit_rate_at_5_total: number;
  hit_rate_at_5_answerable: number;
}

interface RunOutput {
  run_date: string;
  embedding_model: string;
  top_k: number;
  chunking_config: {
    fixed_size_words: number;
    overlap_size_words: number;
    overlap_words: number;
    recursive_max_words: number;
  };
  strategy_summary: StrategySummary[];
  question_runs: PerQuestionResult[];
  advanced_analysis: {
    improved_cases: Array<{
      question_id: string;
      question: string;
      advanced_hit: boolean;
      fixed_hit: boolean;
      overlap_hit: boolean;
    }>;
    worse_cases: Array<{
      question_id: string;
      question: string;
      advanced_hit: boolean;
      fixed_hit: boolean;
      overlap_hit: boolean;
    }>;
  };
}

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
const EMBED_MODEL = process.env.RAG_EMBED_MODEL ?? 'nomic-embed-text';

const CHROMA_HOST = process.env.CHROMA_HOST ?? '127.0.0.1';
const CHROMA_PORT = Number(process.env.CHROMA_PORT ?? '8000');

const TOP_K = Number(process.env.DAY6_TOP_K ?? '5');
const FIXED_WORDS = Number(process.env.DAY6_FIXED_WORDS ?? '180');
const OVERLAP_WORDS = Number(process.env.DAY6_OVERLAP_WORDS ?? '60');
const RECURSIVE_MAX_WORDS = Number(process.env.DAY6_RECURSIVE_MAX_WORDS ?? '180');

const TEST_SET_PATH = resolve(process.cwd(), 'docs', 'pdf-test-set.json');
const JPM_TEXT_PATH = resolve(process.cwd(), 'data', 'pdfs', 'JPM-full.txt');
const JNJ_TEXT_PATH = resolve(process.cwd(), 'data', 'pdfs', 'JNJ-full.txt');

const OUT_DIR = resolve(process.cwd(), 'docs', 'day6');
const OUT_JSON = resolve(OUT_DIR, 'day6-chunking-results.json');
const OUT_MD = resolve(OUT_DIR, 'DAY6_CHUNKING_REPORT.md');

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

function splitLongSentence(sentence: string, maxWords: number): string[] {
  return splitByWords(sentence, maxWords, 0);
}

function splitParagraphToSentenceChunks(paragraph: string, maxWords: number): string[] {
  const sentences = paragraph
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (sentences.length === 0) {
    return splitLongSentence(paragraph, maxWords);
  }

  const out: string[] = [];
  let current: string[] = [];
  let currentCount = 0;

  for (const sentence of sentences) {
    const sentenceWords = sentence.split(/\s+/).filter(Boolean);
    const sentenceCount = sentenceWords.length;

    if (sentenceCount > maxWords) {
      if (current.length > 0) {
        out.push(current.join(' '));
        current = [];
        currentCount = 0;
      }
      out.push(...splitLongSentence(sentence, maxWords));
      continue;
    }

    if (currentCount + sentenceCount > maxWords && current.length > 0) {
      out.push(current.join(' '));
      current = [];
      currentCount = 0;
    }

    current.push(sentence);
    currentCount += sentenceCount;
  }

  if (current.length > 0) {
    out.push(current.join(' '));
  }

  return out;
}

function recursiveChunks(text: string, maxWords: number): string[] {
  const paragraphs = text
    .split(/\n\s*\n/g)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length === 0) {
    return splitByWords(text, maxWords, 0);
  }

  const out: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean).length;
    if (words <= maxWords) {
      out.push(paragraph);
      continue;
    }
    out.push(...splitParagraphToSentenceChunks(paragraph, maxWords));
  }

  return out;
}

function makeChunks(source: string, text: string, strategy: StrategyName): ChunkRecord[] {
  const chunks =
    strategy === 'fixed_size'
      ? splitByWords(text, FIXED_WORDS, 0)
      : strategy === 'overlapping'
        ? splitByWords(text, FIXED_WORDS, OVERLAP_WORDS)
        : recursiveChunks(text, RECURSIVE_MAX_WORDS);

  return chunks.map((chunk, i) => ({
    id: `${source}-${strategy}-c${i + 1}`,
    source,
    text: chunk,
  }));
}

async function callOllamaEmbedding(input: string): Promise<number[]> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: EMBED_MODEL,
      prompt: input,
    }),
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

function hasKeywordHit(retrievedDocs: string[], keywords: string[]): boolean {
  if (keywords.length === 0) return false;
  if (retrievedDocs.length === 0) return false;

  const hay = normalize(retrievedDocs.join(' '));
  return keywords.some((kw) => {
    const needle = normalize(kw);
    return needle.length > 0 && hay.includes(needle);
  });
}

async function recreateCollection(chroma: ChromaClient, name: string): Promise<void> {
  try {
    await chroma.deleteCollection({ name });
  } catch {
    // Ignore if it does not exist.
  }

  await chroma.getOrCreateCollection({
    name,
    embeddingFunction: null,
  });
}

async function ingestStrategy(
  chroma: ChromaClient,
  strategy: StrategyName,
  jpmText: string,
  jnjText: string,
): Promise<string> {
  const collectionName = `day6_${strategy}`;
  await recreateCollection(chroma, collectionName);
  const collection = await chroma.getCollection({ name: collectionName });

  const chunks = [
    ...makeChunks('JPM', jpmText, strategy),
    ...makeChunks('JNJ', jnjText, strategy),
  ];

  console.log(`Indexing strategy=${strategy}, chunks=${chunks.length}`);

  for (let i = 0; i < chunks.length; i += 1) {
    const row = chunks[i];
    if (!row) continue;

    const embedding = await callOllamaEmbedding(row.text);
    await collection.add({
      ids: [row.id],
      embeddings: [embedding],
      documents: [row.text],
      metadatas: [{ source: row.source, strategy }],
    });

    if ((i + 1) % 50 === 0 || i === chunks.length - 1) {
      console.log(`  strategy=${strategy} indexed ${i + 1}/${chunks.length}`);
    }
  }

  return collectionName;
}

async function evaluateStrategy(
  chroma: ChromaClient,
  strategy: StrategyName,
  collectionName: string,
  questions: QuestionEntry[],
): Promise<PerQuestionResult[]> {
  const collection = await chroma.getCollection({ name: collectionName });
  const rows: PerQuestionResult[] = [];

  for (const q of questions) {
    const queryEmbedding = await callOllamaEmbedding(q.question);

    const queryArgs: {
      queryEmbeddings: number[][];
      nResults: number;
      where?: { source: string };
    } = {
      queryEmbeddings: [queryEmbedding],
      nResults: TOP_K,
    };

    if (q.source !== 'NONE') {
      queryArgs.where = { source: q.source };
    }

    const result = await collection.query(queryArgs);
    const ids = result.ids?.[0] ?? [];
    const docs = result.documents?.[0] ?? [];

    const retrievedChunkIds: string[] = [];
    const retrievedDocs: string[] = [];

    for (let i = 0; i < docs.length; i += 1) {
      const id = ids[i];
      const doc = docs[i];
      if (!id || !doc) continue;
      retrievedChunkIds.push(id);
      retrievedDocs.push(doc);
    }

    rows.push({
      question_id: q.id,
      question: q.question,
      source: q.source,
      type: q.type,
      strategy,
      retrieved_chunk_ids: retrievedChunkIds,
      retrieved_text_preview: retrievedDocs.map((d) => d.slice(0, 200)),
      hit_at_5: hasKeywordHit(retrievedDocs, q.keywords),
    });
  }

  return rows;
}

function summarizeStrategy(rows: PerQuestionResult[], questions: QuestionEntry[], strategy: StrategyName): StrategySummary {
  const byQuestion = new Map<string, QuestionEntry>();
  for (const q of questions) byQuestion.set(q.id, q);

  const answerableRows = rows.filter((r) => {
    const q = byQuestion.get(r.question_id);
    return q ? q.type !== 'unanswerable' : true;
  });

  const totalHits = rows.filter((r) => r.hit_at_5).length;
  const answerableHits = answerableRows.filter((r) => r.hit_at_5).length;

  const total = rows.length;
  const answerable = answerableRows.length;

  return {
    strategy,
    total_questions: total,
    answerable_questions: answerable,
    hits_at_5_total: totalHits,
    hits_at_5_answerable: answerableHits,
    hit_rate_at_5_total: total === 0 ? 0 : Number((totalHits / total).toFixed(3)),
    hit_rate_at_5_answerable: answerable === 0 ? 0 : Number((answerableHits / answerable).toFixed(3)),
  };
}

function buildAdvancedAnalysis(
  allRows: PerQuestionResult[],
  questions: QuestionEntry[],
): RunOutput['advanced_analysis'] {
  const grouped = new Map<string, { fixed?: boolean; overlap?: boolean; recursive?: boolean }>();

  for (const row of allRows) {
    const current = grouped.get(row.question_id) ?? {};
    if (row.strategy === 'fixed_size') current.fixed = row.hit_at_5;
    if (row.strategy === 'overlapping') current.overlap = row.hit_at_5;
    if (row.strategy === 'recursive') current.recursive = row.hit_at_5;
    grouped.set(row.question_id, current);
  }

  const qById = new Map<string, QuestionEntry>();
  for (const q of questions) qById.set(q.id, q);

  const improvedCases: RunOutput['advanced_analysis']['improved_cases'] = [];
  const worseCases: RunOutput['advanced_analysis']['worse_cases'] = [];

  grouped.forEach((g, qId) => {
    const q = qById.get(qId);
    if (!q) return;

    const fixedHit = g.fixed ?? false;
    const overlapHit = g.overlap ?? false;
    const advancedHit = g.recursive ?? false;

    if (advancedHit && !fixedHit && !overlapHit) {
      improvedCases.push({
        question_id: qId,
        question: q.question,
        advanced_hit: advancedHit,
        fixed_hit: fixedHit,
        overlap_hit: overlapHit,
      });
    }

    if (!advancedHit && (fixedHit || overlapHit)) {
      worseCases.push({
        question_id: qId,
        question: q.question,
        advanced_hit: advancedHit,
        fixed_hit: fixedHit,
        overlap_hit: overlapHit,
      });
    }
  });

  return {
    improved_cases: improvedCases.slice(0, 5),
    worse_cases: worseCases.slice(0, 3),
  };
}

function markdownReport(output: RunOutput): string {
  const summaryRows = output.strategy_summary
    .map(
      (s) =>
        `| ${s.strategy} | ${s.hits_at_5_answerable}/${s.answerable_questions} | ${(s.hit_rate_at_5_answerable * 100).toFixed(1)}% | ${s.hits_at_5_total}/${s.total_questions} | ${(s.hit_rate_at_5_total * 100).toFixed(1)}% |`,
    )
    .join('\n');

  const improved =
    output.advanced_analysis.improved_cases.length === 0
      ? '- None found in this run.'
      : output.advanced_analysis.improved_cases
          .map((c) => `- ${c.question_id}: ${c.question}`)
          .join('\n');

  const worse =
    output.advanced_analysis.worse_cases.length === 0
      ? '- None found in this run.'
      : output.advanced_analysis.worse_cases
          .map((c) => `- ${c.question_id}: ${c.question}`)
          .join('\n');

  return [
    '# Day 6 Chunking Strategy Comparison',
    '',
    `- Run date: ${output.run_date}`,
    `- Embedding model: ${output.embedding_model}`,
    `- Top-k: ${output.top_k}`,
    `- Corpus: JPM + JNJ full-text files` ,
    '',
    '## Comparison table',
    '',
    '| Strategy | hit-rate@5 (answerable) | hit-rate@5 % (answerable) | hit-rate@5 (all questions) | hit-rate@5 % (all questions) |',
    '|---|---:|---:|---:|---:|',
    summaryRows,
    '',
    '## Analysis',
    '',
    '### 5 cases where advanced chunking improved retrieval',
    improved,
    '',
    '### 3 cases where advanced chunking performed worse',
    worse,
    '',
    '## Notes',
    '',
    '- Advanced strategy used: recursive chunking (paragraph -> sentence -> word fallback).',
    '- Improved means recursive hit and both fixed/overlap miss for the same question.',
    '- Worse means recursive miss while fixed or overlap hits for the same question.',
  ].join('\n');
}

async function run(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  const testSet = JSON.parse(readFileSync(TEST_SET_PATH, 'utf-8')) as TestSet;
  const jpmText = readFileSync(JPM_TEXT_PATH, 'utf-8');
  const jnjText = readFileSync(JNJ_TEXT_PATH, 'utf-8');

  const chroma = new ChromaClient({
    path: `http://${CHROMA_HOST}:${CHROMA_PORT}`,
  });

  const strategies: StrategyName[] = ['fixed_size', 'overlapping', 'recursive'];
  const allRuns: PerQuestionResult[] = [];
  const summaries: StrategySummary[] = [];

  for (const strategy of strategies) {
    const collectionName = await ingestStrategy(chroma, strategy, jpmText, jnjText);
    const rows = await evaluateStrategy(chroma, strategy, collectionName, testSet.questions);
    allRuns.push(...rows);
    summaries.push(summarizeStrategy(rows, testSet.questions, strategy));
  }

  const advancedAnalysis = buildAdvancedAnalysis(allRuns, testSet.questions);

  const output: RunOutput = {
    run_date: new Date().toISOString(),
    embedding_model: EMBED_MODEL,
    top_k: TOP_K,
    chunking_config: {
      fixed_size_words: FIXED_WORDS,
      overlap_size_words: FIXED_WORDS,
      overlap_words: OVERLAP_WORDS,
      recursive_max_words: RECURSIVE_MAX_WORDS,
    },
    strategy_summary: summaries,
    question_runs: allRuns,
    advanced_analysis: advancedAnalysis,
  };

  writeFileSync(OUT_JSON, JSON.stringify(output, null, 2), 'utf-8');
  writeFileSync(OUT_MD, markdownReport(output), 'utf-8');

  console.log(`Saved JSON: ${OUT_JSON}`);
  console.log(`Saved report: ${OUT_MD}`);
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error('Day 6 chunking comparison failed:\n', message);
  process.exit(1);
});
