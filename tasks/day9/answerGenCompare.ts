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

// Structured JSON for citation-enforced prompt
interface StructuredAnswer {
  answer: string;
  citations: string[];
  confidence: number;
}

type PromptStyle = 'freeform' | 'citation_enforced';

interface InvalidOutput {
  question_id: string;
  question: string;
  prompt_style: PromptStyle;
  raw_output: string;
  failure_reason: string;
}

interface HallucinationExample {
  question_id: string;
  question: string;
  prompt_style: PromptStyle;
  answer: string;
  ground_truth: string;
  hallucinated_content: string;
  reason: string;
}

interface VariantResult {
  ids: string[];
  answer: string;
  answer_correct: boolean;
  citations: string[];
  citation_present: boolean;
  confidence: number | undefined;
  json_valid: boolean;
  raw_output: string;
}

interface PerQuestionResult {
  question_id: string;
  source: string;
  type: string;
  question: string;
  ground_truth: string;
  freeform: VariantResult;
  citation_enforced: VariantResult;
}

interface SummaryMetrics {
  answer_correct_rate: number;
  citation_presence_rate: number;
  json_validity_rate: number;
  avg_confidence: number;
}

interface RunOutput {
  run_date: string;
  llm_model: string;
  embedding_model: string;
  top_k: number;
  summary: {
    freeform: SummaryMetrics;
    citation_enforced: SummaryMetrics;
  };
  hallucinations: HallucinationExample[];
  invalid_outputs: InvalidOutput[];
  per_question: PerQuestionResult[];
}

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
const LLM_MODEL = process.env.RAG_LLM_MODEL ?? process.env.OLLAMA_MODEL ?? 'llama3';
const EMBED_MODEL = process.env.RAG_EMBED_MODEL ?? 'nomic-embed-text';

const CHROMA_HOST = process.env.CHROMA_HOST ?? '127.0.0.1';
const CHROMA_PORT = Number(process.env.CHROMA_PORT ?? '8000');

const TOP_K = Number(process.env.DAY9_TOP_K ?? '5');
const CHUNK_WORDS = Number(process.env.DAY9_CHUNK_WORDS ?? '170');
const CHUNK_OVERLAP_WORDS = Number(process.env.DAY9_CHUNK_OVERLAP_WORDS ?? '40');

const TEST_SET_PATH = resolve(process.cwd(), 'docs', 'day3', 'pdf-test-set.json');
const JPM_PAGES_PATH = resolve(process.cwd(), 'data', 'pdfs', 'JPM-pages.json');
const JNJ_PAGES_PATH = resolve(process.cwd(), 'data', 'pdfs', 'JNJ-pages.json');

const OUT_DIR = resolve(process.cwd(), 'docs', 'day9');
const OUT_JSON = resolve(OUT_DIR, 'day9-answer-gen-results.json');
const OUT_MD = resolve(OUT_DIR, 'DAY9_ANSWER_GEN_REPORT.md');

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
      options: { temperature: 0.3, num_predict: numPredict },
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

async function generateFreeformAnswer(question: string, docs: RetrievedDoc[]): Promise<string> {
  const context = docs
    .slice(0, TOP_K)
    .map((d) => `[${d.id}] ${d.text.slice(0, 700)}`)
    .join('\n\n');

  if (!context) return 'Insufficient context.';

  const prompt = [
    'Answer the question using only the provided context.',
    'If the answer is not supported by context, say exactly: Insufficient context.',
    'Keep the answer concise and natural.',
    'Optionally cite supporting chunk ids in brackets, e.g. [JPM-p10-c2].',
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

async function generateCitationEnforcedAnswer(question: string, docs: RetrievedDoc[]): Promise<StructuredAnswer | null> {
  const context = docs
    .slice(0, TOP_K)
    .map((d) => `[${d.id}] ${d.text.slice(0, 700)}`)
    .join('\n\n');

  if (!context) {
    return { answer: 'Insufficient context.', citations: [], confidence: 0 };
  }

  const prompt = [
    'Answer the question using ONLY the provided context.',
    'You MUST respond with valid JSON in this exact format:',
    '{"answer":"...","citations":["id1","id2"],"confidence":0.0}',
    '',
    'Rules:',
    '- If context does not support an answer, use answer: "Insufficient context." with empty citations and confidence: 0',
    '- confidence is a number between 0.0 and 1.0 (how confident you are in the answer)',
    '- citations must be a list of chunk ids from the context (without brackets)',
    '- answer should be concise',
    '- Return ONLY the JSON, no other text',
    '',
    `Question: ${question}`,
    '',
    'Context:',
    context,
    '',
    'JSON:',
  ].join('\n');

  const raw = await callOllamaGenerate(prompt, 220);

  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;

    const jsonText = raw.slice(start, end + 1);
    const parsed = JSON.parse(jsonText);

    // Validate structure
    if (typeof parsed.answer !== 'string' || !Array.isArray(parsed.citations)) {
      return null;
    }

    return {
      answer: String(parsed.answer).trim(),
      citations: parsed.citations.map(String),
      confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
    };
  } catch {
    return null;
  }
}

async function retrieveHybrid(
  collection: Awaited<ReturnType<ChromaClient['getCollection']>>,
  chunks: DocChunk[],
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
  const vectorResult = await collection.query(queryArgs);
  const vectorDocs = toRetrievedDocs(vectorResult);
  const lexicalDocs = lexicalRetrieve(chunks, q.question, q.source, nResults);
  return rrfFuse([vectorDocs, lexicalDocs], nResults);
}

function summarize(rows: PerQuestionResult[], style: PromptStyle): SummaryMetrics {
  const chosen = rows.map((r) => (style === 'freeform' ? r.freeform : r.citation_enforced));
  const total = chosen.length || 1;

  const correct = chosen.filter((x) => x.answer_correct).length;
  const citations = chosen.filter((x) => x.citation_present).length;
  const jsonValid = chosen.filter((x) => x.json_valid).length;
  const confidence = chosen.map((x) => x.confidence ?? 0).reduce((a, b) => a + b, 0) / total;

  return {
    answer_correct_rate: Number((correct / total).toFixed(3)),
    citation_presence_rate: Number((citations / total).toFixed(3)),
    json_validity_rate: Number((jsonValid / total).toFixed(3)),
    avg_confidence: Number(confidence.toFixed(3)),
  };
}

function buildMarkdown(output: RunOutput): string {
  const s = output.summary;

  const hallucExamples =
    output.hallucinations.length === 0
      ? '- None identified in this run.'
      : output.hallucinations
          .map(
            (e) =>
              `- ${e.question_id} (${e.prompt_style})\n  - Q: ${e.question}\n  - Ground truth: ${e.ground_truth}\n  - Generated: ${e.answer}\n  - Hallucination: ${e.hallucinated_content}\n  - Why: ${e.reason}`,
          )
          .join('\n\n');

  const invalidExamples =
    output.invalid_outputs.length === 0
      ? '- None in this run.'
      : output.invalid_outputs
          .map((e) => `- ${e.question_id} (${e.prompt_style})\n  - Q: ${e.question}\n  - Failure: ${e.failure_reason}\n  - Output: ${e.raw_output.slice(0, 200)}...`)
          .join('\n\n');

  return [
    '# Day 9 Answer Generation: Freeform vs. Citation-Enforced Prompts',
    '',
    `- Run date: ${output.run_date}`,
    `- LLM model: ${output.llm_model}`,
    `- Embedding model: ${output.embedding_model}`,
    `- Retrieval top-k: ${output.top_k}`,
    '',
    '## Comparison tables',
    '',
    '### Answer correctness & citation presence',
    '',
    '| Metric | Freeform | Citation-Enforced |',
    '|---|---:|---:|',
    `| Answer correctness | ${(s.freeform.answer_correct_rate * 100).toFixed(1)}% | ${(s.citation_enforced.answer_correct_rate * 100).toFixed(1)}% |`,
    `| Citation presence | ${(s.freeform.citation_presence_rate * 100).toFixed(1)}% | ${(s.citation_enforced.citation_presence_rate * 100).toFixed(1)}% |`,
    `| JSON validity | ${(s.freeform.json_validity_rate * 100).toFixed(1)}% | ${(s.citation_enforced.json_validity_rate * 100).toFixed(1)}% |`,
    `| Avg confidence | ${s.freeform.avg_confidence.toFixed(3)} | ${s.citation_enforced.avg_confidence.toFixed(3)} |`,
    '',
    '## Analysis',
    '',
    '### 5 hallucination examples and root causes',
    '',
    hallucExamples,
    '',
    '### 5 invalid outputs with failure reasons',
    '',
    invalidExamples,
    '',
    '## Notes',
    '',
    '- Freeform prompt: Natural language generation with optional citations.',
    '- Citation-enforced prompt: Structured JSON output requirement with mandatory citations and confidence scoring.',
    '- Hallucinations: Generated content not supported by the retrieved context.',
    '- Invalid outputs: JSON parsing failures or missing required fields.',
  ].join('\n');
}

async function recreateCollection(chroma: ChromaClient, name: string): Promise<void> {
  try {
    await chroma.deleteCollection({ name });
  } catch {
    // Collection may not exist.
  }
  await chroma.getOrCreateCollection({ name, embeddingFunction: null });
}

function isHallucination(q: QuestionEntry, answer: string): boolean {
  if (q.type === 'unanswerable') {
    const a = normalize(answer);
    return !(a.includes('insufficient context') || a.includes('cannot be determined') || a.includes('not available'));
  }
  // Answer is hallucinated if it doesn't match keywords but is not unanswerable
  return !hasKeywordHit([answer], q.keywords);
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  const testSet = JSON.parse(readFileSync(TEST_SET_PATH, 'utf-8')) as TestSet;
  const jpmPages = JSON.parse(readFileSync(JPM_PAGES_PATH, 'utf-8')) as PageCorpus;
  const jnjPages = JSON.parse(readFileSync(JNJ_PAGES_PATH, 'utf-8')) as PageCorpus;

  const allChunks = [...buildChunksFromPages(jpmPages), ...buildChunksFromPages(jnjPages)];
  console.log(`Prepared chunks: ${allChunks.length}`);

  const chroma = new ChromaClient({ host: CHROMA_HOST, port: CHROMA_PORT, ssl: false });
  const collectionName = 'day9_answer_gen_eval';

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
  const hallucinations: HallucinationExample[] = [];
  const invalidOutputs: InvalidOutput[] = [];

  console.log(`Running ${testSet.questions.length} questions...`);
  for (const q of testSet.questions) {
    process.stdout.write(`  ${q.id}... `);

    // Retrieve documents
    const docs = await retrieveHybrid(collection, allChunks, q, TOP_K);

    // Generate freeform answer
    const freeformRaw = await generateFreeformAnswer(q.question, docs);
    const freeformCited = extractCitedIds(freeformRaw);
    const freeformCorrect = answerCorrect(q, freeformRaw);

    // Generate citation-enforced answer
    let citationEnforcedRaw = '';
    let citationEnforcedParsed: StructuredAnswer | null = null;
    let citationEnforcedValid = false;

    // Try to generate structured answer (may fail JSON parsing)
    try {
      const raw = await callOllamaGenerate(
        [
          'Answer the question using ONLY the provided context.',
          'You MUST respond with valid JSON in this exact format:',
          '{"answer":"...","citations":["id1","id2"],"confidence":0.0}',
          '',
          'Rules:',
          '- If context does not support an answer, use answer: "Insufficient context." with empty citations and confidence: 0',
          '- confidence is a number between 0.0 and 1.0',
          '- citations must be a list of chunk ids (without brackets)',
          '- Return ONLY the JSON, no other text',
          '',
          `Question: ${q.question}`,
          '',
          'Context:',
          docs
            .slice(0, TOP_K)
            .map((d) => `[${d.id}] ${d.text.slice(0, 700)}`)
            .join('\n\n'),
          '',
          'JSON:',
        ].join('\n'),
        220,
      );
      citationEnforcedRaw = raw;

      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start >= 0 && end > start) {
        const jsonText = raw.slice(start, end + 1);
        const parsed = JSON.parse(jsonText);
        if (typeof parsed.answer === 'string' && Array.isArray(parsed.citations)) {
          citationEnforcedParsed = {
            answer: parsed.answer.trim(),
            citations: parsed.citations.map(String),
            confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
          };
          citationEnforcedValid = true;
        } else {
          invalidOutputs.push({
            question_id: q.id,
            question: q.question,
            prompt_style: 'citation_enforced',
            raw_output: raw,
            failure_reason: 'Missing required JSON fields (answer, citations, or confidence)',
          });
        }
      } else {
        invalidOutputs.push({
          question_id: q.id,
          question: q.question,
          prompt_style: 'citation_enforced',
          raw_output: raw,
          failure_reason: 'No JSON object found in output',
        });
      }
    } catch (err) {
      invalidOutputs.push({
        question_id: q.id,
        question: q.question,
        prompt_style: 'citation_enforced',
        raw_output: citationEnforcedRaw,
        failure_reason: `JSON parse error: ${String(err).slice(0, 100)}`,
      });
    }

    // Check for hallucinations in both outputs
    if (isHallucination(q, freeformRaw) && freeformCorrect === false) {
      hallucinations.push({
        question_id: q.id,
        question: q.question,
        prompt_style: 'freeform',
        answer: freeformRaw,
        ground_truth: q.ground_truth,
        hallucinated_content: freeformRaw.slice(0, 100),
        reason: 'Answer contains unsupported content not found in context and does not match expected keywords',
      });
    }

    if (
      citationEnforcedParsed &&
      isHallucination(q, citationEnforcedParsed.answer) &&
      answerCorrect(q, citationEnforcedParsed.answer) === false
    ) {
      hallucinations.push({
        question_id: q.id,
        question: q.question,
        prompt_style: 'citation_enforced',
        answer: citationEnforcedParsed.answer,
        ground_truth: q.ground_truth,
        hallucinated_content: citationEnforcedParsed.answer.slice(0, 100),
        reason: 'Answer contains unsupported content not found in context despite JSON format requirement',
      });
    }

    rows.push({
      question_id: q.id,
      source: q.source,
      type: q.type,
      question: q.question,
      ground_truth: q.ground_truth,
      freeform: {
        ids: docs.map((d) => d.id),
        answer: freeformRaw,
        answer_correct: freeformCorrect,
        citations: freeformCited,
        citation_present: freeformCited.length > 0,
        confidence: undefined,
        json_valid: true, // freeform doesn't require JSON
        raw_output: freeformRaw,
      },
      citation_enforced: {
        ids: docs.map((d) => d.id),
        answer: citationEnforcedParsed?.answer ?? citationEnforcedRaw,
        answer_correct: citationEnforcedParsed ? answerCorrect(q, citationEnforcedParsed.answer) : false,
        citations: citationEnforcedParsed?.citations ?? [],
        citation_present: (citationEnforcedParsed?.citations ?? []).length > 0,
        confidence: citationEnforcedParsed?.confidence,
        json_valid: citationEnforcedValid,
        raw_output: citationEnforcedRaw,
      },
    });

    console.log('done');
  }

  // Limit hallucinations and invalid outputs to 5 each
  const top5Hallucinations = hallucinations.slice(0, 5);
  const top5InvalidOutputs = invalidOutputs.slice(0, 5);

  const output: RunOutput = {
    run_date: new Date().toISOString(),
    llm_model: LLM_MODEL,
    embedding_model: EMBED_MODEL,
    top_k: TOP_K,
    summary: {
      freeform: summarize(rows, 'freeform'),
      citation_enforced: summarize(rows, 'citation_enforced'),
    },
    hallucinations: top5Hallucinations,
    invalid_outputs: top5InvalidOutputs,
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
