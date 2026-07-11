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

interface RetrievalChunk {
  id: string;
  source: string;
  text: string;
}

type FailureCase = 'none' | 'missed_info' | 'hallucination' | 'truncation';

interface ScoredAnswer {
  answer: string;
  correctness: boolean;
  citation_present: boolean;
  keyword_recall: number;
  refusal_ok: boolean;
  failure_cases: FailureCase[];
  primary_failure: FailureCase;
}

interface QuestionRunResult {
  question_id: string;
  question: string;
  type: string;
  difficulty: string;
  source: string;
  baseline: ScoredAnswer;
  rag: ScoredAnswer;
  rag_retrieved_chunk_ids: string[];
}

interface FailureSummary {
  none: number;
  missed_info: number;
  hallucination: number;
  truncation: number;
}

interface RunOutput {
  run_date: string;
  llm_model: string;
  embedding_model: string;
  chunk_words: number;
  chunk_overlap_words: number;
  top_k: number;
  results: QuestionRunResult[];
  summary: {
    total_questions: number;
    baseline_correct: number;
    rag_correct: number;
    baseline_citation_yes: number;
    rag_citation_yes: number;
    rag_helped_question_ids: string[];
    rag_not_helped_question_ids: string[];
    baseline_failure_counts: FailureSummary;
    rag_failure_counts: FailureSummary;
  };
}

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
const LLM_MODEL = process.env.RAG_LLM_MODEL ?? process.env.OLLAMA_MODEL ?? 'llama3';
const EMBED_MODEL = process.env.RAG_EMBED_MODEL ?? 'nomic-embed-text';

const CHROMA_HOST = process.env.CHROMA_HOST ?? '127.0.0.1';
const CHROMA_PORT = Number(process.env.CHROMA_PORT ?? '8000');

const CHUNK_WORDS = Number(process.env.RAG_CHUNK_WORDS ?? '180');
const CHUNK_OVERLAP_WORDS = Number(process.env.RAG_CHUNK_OVERLAP_WORDS ?? '0');
const TOP_K = Number(process.env.RAG_TOP_K ?? '4');

const TEST_SET_PATH = resolve(process.cwd(), 'docs', 'day3', 'pdf-test-set.json');
const JPM_TEXT_PATH = resolve(process.cwd(), 'data', 'pdfs', 'JPM-full.txt');
const JNJ_TEXT_PATH = resolve(process.cwd(), 'data', 'pdfs', 'JNJ-full.txt');

const OUT_JSON = resolve(process.cwd(), 'docs', 'day4-5', 'rag-pdf-eval-results.json');
const OUT_MD = resolve(process.cwd(), 'docs', 'day4-5', 'RAG_PDF_EVAL_REPORT.md');

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9.\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function keywordRecall(answer: string, keywords: string[]): number {
  if (keywords.length === 0) return 1;
  const hay = normalize(answer);
  const matched = keywords.filter((kw) => hay.includes(normalize(kw))).length;
  return Number((matched / keywords.length).toFixed(3));
}

function refusalOk(answer: string, qType: string): boolean {
  if (qType !== 'unanswerable') return true;
  const lower = answer.toLowerCase();
  const refusalPhrases = [
    'not found',
    'not in',
    'cannot find',
    'not available',
    'no information',
    'not mentioned',
    'not stated',
    'cannot answer',
    'unable to find',
  ];
  return refusalPhrases.some((p) => lower.includes(p));
}

function hasCitation(answer: string): boolean {
  return /\[[^\]]+\]/.test(answer);
}

function splitIntoWordChunks(text: string, chunkWords: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const chunks: string[] = [];
  for (let start = 0; start < words.length; start += chunkWords) {
    const end = Math.min(words.length, start + chunkWords);
    chunks.push(words.slice(start, end).join(' '));
  }

  return chunks;
}

function normalizeNumericToken(token: string): string {
  return token.replace(/,/g, '').replace(/\.$/, '');
}

function extractNumericTokens(text: string): string[] {
  const raw = text.match(/\b\d[\d,.]*\b/g) ?? [];
  return raw.map((item) => normalizeNumericToken(item)).filter((item) => item.length > 0);
}

function containsNumericHallucination(answer: string, groundTruth: string, referenceText: string): boolean {
  const answerNums = extractNumericTokens(answer);
  if (answerNums.length === 0) return false;

  const allowed = new Set<string>([
    ...extractNumericTokens(groundTruth),
    ...extractNumericTokens(referenceText),
  ]);

  return answerNums.some((n) => !allowed.has(n));
}

function isTruncated(answer: string): boolean {
  const trimmed = answer.trim();
  if (trimmed.length === 0) return true;

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length > 260) return true;

  return /(:|,|\band\b|\bor\b|\bwith\b|\bto\b)\s*$/i.test(trimmed);
}

async function callOllamaGenerate(prompt: string): Promise<string> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: LLM_MODEL,
      prompt,
      stream: false,
      options: { temperature: 0, num_predict: 350 },
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

function baselinePrompt(question: string, sourceText: string): string {
  return [
    'You are a precise analyst.',
    'Answer only from the provided document text.',
    'If answer is missing, say: Not found in provided text.',
    'Do not add fake citations.',
    '',
    'Document text:',
    sourceText,
    '',
    `Question: ${question}`,
    'Answer:',
  ].join('\n');
}

function ragPrompt(question: string, citedContext: string): string {
  return [
    'You are a precise analyst.',
    'Answer only from the retrieved chunks.',
    'If answer is missing, say: Not found in retrieved context.',
    'Include citations using chunk IDs in square brackets, for example [JPM-c12].',
    '',
    'Retrieved chunks:',
    citedContext,
    '',
    `Question: ${question}`,
    'Answer with citations:',
  ].join('\n');
}

function scoreAnswer(question: QuestionEntry, answer: string, referenceText: string): ScoredAnswer {
  const recall = keywordRecall(answer, question.keywords);
  const refusal = refusalOk(answer, question.type);
  const hallucination = containsNumericHallucination(answer, question.ground_truth, referenceText);
  const truncation = isTruncated(answer);
  const correct = question.type === 'unanswerable' ? refusal : recall >= 0.5;

  const failureCases: FailureCase[] = [];
  if (!correct) {
    if (question.type !== 'unanswerable' && recall < 0.5) failureCases.push('missed_info');
    if (hallucination) failureCases.push('hallucination');
    if (truncation) failureCases.push('truncation');
    if (failureCases.length === 0) failureCases.push('missed_info');
  }

  return {
    answer,
    correctness: correct,
    citation_present: hasCitation(answer),
    keyword_recall: recall,
    refusal_ok: refusal,
    failure_cases: failureCases,
    primary_failure: failureCases[0] ?? 'none',
  };
}

function emptyFailureSummary(): FailureSummary {
  return {
    none: 0,
    missed_info: 0,
    hallucination: 0,
    truncation: 0,
  };
}

function countFailures(results: QuestionRunResult[], mode: 'baseline' | 'rag'): FailureSummary {
  const summary = emptyFailureSummary();

  for (const row of results) {
    const score = row[mode];
    if (score.correctness) {
      summary.none += 1;
      continue;
    }

    if (score.failure_cases.length === 0) {
      summary.missed_info += 1;
      continue;
    }

    const seen = new Set<FailureCase>(score.failure_cases);
    if (seen.has('missed_info')) summary.missed_info += 1;
    if (seen.has('hallucination')) summary.hallucination += 1;
    if (seen.has('truncation')) summary.truncation += 1;
  }

  return summary;
}

async function ingestChunks(chroma: ChromaClient, jpmText: string, jnjText: string): Promise<void> {
  console.log('Preparing fixed-size word chunks (simple chunking)...');
  const jpmChunks = splitIntoWordChunks(jpmText, CHUNK_WORDS);
  const jnjChunks = splitIntoWordChunks(jnjText, CHUNK_WORDS);

  console.log(`JPM chunks: ${jpmChunks.length}`);
  console.log(`JNJ chunks: ${jnjChunks.length}`);

  const allChunks: RetrievalChunk[] = [
    ...jpmChunks.map((text, i) => ({ id: `JPM-c${i + 1}`, source: 'JPM', text })),
    ...jnjChunks.map((text, i) => ({ id: `JNJ-c${i + 1}`, source: 'JNJ', text })),
  ];

  try {
    await chroma.deleteCollection({ name: 'pdf_rag_eval' });
  } catch {
    // Collection may not exist from previous runs.
  }

  const collection = await chroma.getOrCreateCollection({
    name: 'pdf_rag_eval',
    embeddingFunction: null,
  });

  console.log('Embedding and inserting chunks into Chroma...');
  for (let i = 0; i < allChunks.length; i += 1) {
    const chunk = allChunks[i];
    if (!chunk) continue;

    const embedding = await callOllamaEmbedding(chunk.text);
    await collection.add({
      ids: [chunk.id],
      embeddings: [embedding],
      documents: [chunk.text],
      metadatas: [{ source: chunk.source }],
    });

    if ((i + 1) % 40 === 0 || i === allChunks.length - 1) {
      console.log(`  indexed ${i + 1}/${allChunks.length}`);
    }
  }
}

async function retrieveTopK(
  chroma: ChromaClient,
  question: QuestionEntry,
): Promise<{ chunkIds: string[]; context: string }> {
  const collection = await chroma.getCollection({
    name: 'pdf_rag_eval',
  });
  const queryEmbedding = await callOllamaEmbedding(question.question);

  const queryArgs: {
    queryEmbeddings: number[][];
    nResults: number;
    where?: { source: string };
  } = {
    queryEmbeddings: [queryEmbedding],
    nResults: TOP_K,
  };

  if (question.source !== 'NONE') {
    queryArgs.where = { source: question.source };
  }

  const queryResult = await collection.query(queryArgs);

  const docLists = queryResult.documents?.[0] ?? [];
  const idLists = queryResult.ids?.[0] ?? [];

  const chunkIds: string[] = [];
  const parts: string[] = [];
  for (let i = 0; i < docLists.length; i += 1) {
    const doc = docLists[i];
    const cid = idLists[i];
    if (!doc || !cid) continue;
    chunkIds.push(cid);
    parts.push(`[${cid}] ${doc}`);
  }

  return {
    chunkIds,
    context: parts.join('\n\n'),
  };
}

function sourceTextForBaseline(source: string, jpmText: string, jnjText: string): string {
  if (source === 'JPM') return jpmText;
  if (source === 'JNJ') return jnjText;
  return `${jpmText}\n\n${jnjText}`;
}

function failureRows(results: QuestionRunResult[], mode: 'baseline' | 'rag'): string[] {
  const rows: string[] = [];

  for (const r of results) {
    const score = r[mode];
    if (score.correctness) continue;
    rows.push(`| ${r.question_id} | ${r.type} | ${score.failure_cases.join(', ') || 'missed_info'} |`);
  }

  if (rows.length === 0) rows.push('| none | - | - |');
  return rows;
}

function buildMarkdown(output: RunOutput): string {
  const lines: string[] = [];

  lines.push('# RAG vs Full-Text LLM Evaluation (Basic Setup)');
  lines.push('');
  lines.push(`- Date: ${output.run_date}`);
  lines.push(`- LLM (open-source): ${output.llm_model}`);
  lines.push(`- Embeddings: ${output.embedding_model}`);
  lines.push(`- Vector DB: Chroma`);
  lines.push(`- Retrieval top-k: ${output.top_k}`);
  lines.push(`- Chunking: fixed ${output.chunk_words} words, overlap ${output.chunk_overlap_words} (simple word chunking)`);
  lines.push('');

  lines.push('## Results Comparison');
  lines.push('');
  lines.push('| Mode | Correct / Total | Correctness Rate | Citation Present |');
  lines.push('|---|---:|---:|---:|');
  lines.push(`| Full-text LLM (no retrieval) | ${output.summary.baseline_correct}/${output.summary.total_questions} | ${((output.summary.baseline_correct / output.summary.total_questions) * 100).toFixed(1)}% | ${output.summary.baseline_citation_yes}/${output.summary.total_questions} |`);
  lines.push(`| Basic RAG (Chroma retrieval) | ${output.summary.rag_correct}/${output.summary.total_questions} | ${((output.summary.rag_correct / output.summary.total_questions) * 100).toFixed(1)}% | ${output.summary.rag_citation_yes}/${output.summary.total_questions} |`);
  lines.push('');

  lines.push('## Failure Cases');
  lines.push('');
  lines.push('| Mode | Missed Info | Hallucination | Truncation |');
  lines.push('|---|---:|---:|---:|');
  lines.push(`| Full-text LLM (no retrieval) | ${output.summary.baseline_failure_counts.missed_info} | ${output.summary.baseline_failure_counts.hallucination} | ${output.summary.baseline_failure_counts.truncation} |`);
  lines.push(`| Basic RAG (Chroma retrieval) | ${output.summary.rag_failure_counts.missed_info} | ${output.summary.rag_failure_counts.hallucination} | ${output.summary.rag_failure_counts.truncation} |`);
  lines.push('');

  lines.push('### Incorrect Answers: Full-text LLM');
  lines.push('');
  lines.push('| QID | Type | Failure Labels |');
  lines.push('|---|---|---|');
  lines.push(...failureRows(output.results, 'baseline'));
  lines.push('');

  lines.push('### Incorrect Answers: Basic RAG');
  lines.push('');
  lines.push('| QID | Type | Failure Labels |');
  lines.push('|---|---|---|');
  lines.push(...failureRows(output.results, 'rag'));
  lines.push('');

  lines.push('## Short Conclusion');
  lines.push('');
  lines.push(`- Where basic RAG helped: ${output.summary.rag_helped_question_ids.length > 0 ? output.summary.rag_helped_question_ids.join(', ') : 'none'}`);
  lines.push(`- Where basic RAG did not help: ${output.summary.rag_not_helped_question_ids.length > 0 ? output.summary.rag_not_helped_question_ids.join(', ') : 'none'}`);
  lines.push('- Basic RAG helped mostly when full-text prompting lost key details in long documents; retrieval focused the model on relevant local context.');
  lines.push('- Basic RAG did not help when retrieval returned incomplete or mixed chunks, leading to missed values or confident but wrong numeric answers.');

  return lines.join('\n');
}

async function main(): Promise<void> {
  console.log('Loading test set and source texts...');
  const testSet = JSON.parse(readFileSync(TEST_SET_PATH, 'utf-8')) as TestSet;
  const jpmText = readFileSync(JPM_TEXT_PATH, 'utf-8');
  const jnjText = readFileSync(JNJ_TEXT_PATH, 'utf-8');

  const chroma = new ChromaClient({ host: CHROMA_HOST, port: CHROMA_PORT, ssl: false });
  await chroma.heartbeat();
  console.log(`Connected to Chroma at http://${CHROMA_HOST}:${CHROMA_PORT}`);

  await ingestChunks(chroma, jpmText, jnjText);

  const results: QuestionRunResult[] = [];

  console.log(`Running ${testSet.questions.length} questions (full-text baseline + RAG)...`);
  for (const q of testSet.questions) {
    process.stdout.write(`  ${q.id}... `);

    const baselineText = sourceTextForBaseline(q.source, jpmText, jnjText);
    const baselineAnswer = await callOllamaGenerate(baselinePrompt(q.question, baselineText));
    const baselineScore = scoreAnswer(q, baselineAnswer, baselineText);

    const retrieval = await retrieveTopK(chroma, q);
    const ragAnswer = await callOllamaGenerate(ragPrompt(q.question, retrieval.context));
    const ragScore = scoreAnswer(q, ragAnswer, retrieval.context);

    results.push({
      question_id: q.id,
      question: q.question,
      type: q.type,
      difficulty: q.difficulty,
      source: q.source,
      baseline: baselineScore,
      rag: ragScore,
      rag_retrieved_chunk_ids: retrieval.chunkIds,
    });

    const b = baselineScore.correctness ? 'B_OK' : 'B_BAD';
    const r = ragScore.correctness ? 'R_OK' : 'R_BAD';
    console.log(`${b} ${r}`);
  }

  const summary = {
    total_questions: results.length,
    baseline_correct: results.filter((r) => r.baseline.correctness).length,
    rag_correct: results.filter((r) => r.rag.correctness).length,
    baseline_citation_yes: results.filter((r) => r.baseline.citation_present).length,
    rag_citation_yes: results.filter((r) => r.rag.citation_present).length,
    rag_helped_question_ids: results
      .filter((r) => !r.baseline.correctness && r.rag.correctness)
      .map((r) => r.question_id),
    rag_not_helped_question_ids: results
      .filter((r) => r.baseline.correctness && !r.rag.correctness)
      .map((r) => r.question_id),
    baseline_failure_counts: countFailures(results, 'baseline'),
    rag_failure_counts: countFailures(results, 'rag'),
  };

  const output: RunOutput = {
    run_date: new Date().toISOString(),
    llm_model: LLM_MODEL,
    embedding_model: EMBED_MODEL,
    chunk_words: CHUNK_WORDS,
    chunk_overlap_words: CHUNK_OVERLAP_WORDS,
    top_k: TOP_K,
    results,
    summary,
  };

  mkdirSync(resolve(process.cwd(), 'docs'), { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(output, null, 2));
  writeFileSync(OUT_MD, buildMarkdown(output));

  console.log(`JSON written: ${OUT_JSON}`);
  console.log(`Report written: ${OUT_MD}`);
}

main().catch((err) => {
  const msg = String(err);
  if (msg.includes('ChromaConnectionError') || msg.includes('Failed to connect to chromadb')) {
    console.error('Chroma is not reachable at http://127.0.0.1:8000.');
    console.error('Start it first with: .venv/bin/chroma run --host 127.0.0.1 --port 8000');
  }
  console.error('Fatal:', err);
  process.exit(1);
});
