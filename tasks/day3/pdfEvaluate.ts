// # PDF Comparison Evaluation
// Runs a 25-question test set against two Ollama models (LLM-A and LLM-B).
// Scores each response on 4 metrics, computes pass/fail, and writes:
//   docs/day3/pdf-eval-results.json
//   docs/day3/PDF_EVAL_REPORT.md

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Config ────────────────────────────────────────────────────────────────────
const MODEL_A = process.env.LLM_A ?? 'llama3';
const MODEL_B = process.env.LLM_B ?? 'gemma3:4b';
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
const TEMPERATURE = 0;                   // deterministic setting for both models
const NUM_PREDICT = 400;

const TEST_SET_PATH = resolve(process.cwd(), 'docs', 'day3', 'pdf-test-set.json');
const JPM_TEXT_PATH = resolve(process.cwd(), 'data', 'pdfs', 'JPM-full.txt');
const JNJ_TEXT_PATH = resolve(process.cwd(), 'data', 'pdfs', 'JNJ-full.txt');
const OUT_JSON = resolve(process.cwd(), 'docs', 'day3', 'pdf-eval-results.json');
const OUT_MD   = resolve(process.cwd(), 'docs', 'day3', 'PDF_EVAL_REPORT.md');

// Characters of source context sent per question (keep within token budget)
const CONTEXT_CHARS = 8000;

// ── Types ─────────────────────────────────────────────────────────────────────
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
    sources: Array<{ id: string; label: string; file: string }>;
  };
  questions: QuestionEntry[];
}

interface MetricScores {
  keyword_recall: number;     // 0-1: fraction of ground-truth keywords found
  refusal_accuracy: number;   // 0 or 1: for unanswerable questions, did model correctly refuse?
  answer_length_ok: number;   // 0 or 1: answer is not empty and not excessively long (>800 tokens)
  no_hallucination: number;   // 0 or 1: response does not invent specific numbers absent from ground truth
}

interface QuestionResult {
  question_id: string;
  model: string;
  question: string;
  type: string;
  difficulty: string;
  source: string;
  response: string;
  latency_ms: number;
  metrics: MetricScores;
  composite_score: number;    // average of the 4 metric values
  pass: boolean;              // composite_score >= 0.5 AND no hallucination
  failure_reason: string;
}

interface EvalOutput {
  run_date: string;
  model_a: string;
  model_b: string;
  temperature: number;
  results_a: QuestionResult[];
  results_b: QuestionResult[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9.\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function keywordRecall(response: string, keywords: string[]): number {
  if (keywords.length === 0) return 1;
  const hay = normalize(response);
  const matched = keywords.filter(kw => hay.includes(normalize(kw))).length;
  return Number((matched / keywords.length).toFixed(3));
}

function refusalAccuracy(response: string, qType: string): number {
  if (qType !== 'unanswerable') return 1; // not a refusal question, skip
  const lower = response.toLowerCase();
  const refusalPhrases = [
    'not found', 'not in', 'cannot find', 'not available', 'not provided',
    'no information', 'not mentioned', 'not stated', 'not included',
    'cannot answer', 'not in the', 'unable to find', 'not contained',
  ];
  return refusalPhrases.some(p => lower.includes(p)) ? 1 : 0;
}

function answerLengthOk(response: string): number {
  const wordCount = response.trim().split(/\s+/).length;
  return response.trim().length > 5 && wordCount <= 350 ? 1 : 0;
}

/**
 * Heuristic: if the response contains a specific 7+ digit numeric string that
 * is NOT in the ground truth or the source context snippet, flag as potential
 * hallucination.
 */
function noHallucination(response: string, groundTruth: string, contextSnippet: string): number {
  const numericPattern = /\b\d{7,}\b/g;
  const responseNums = [...response.matchAll(numericPattern)].map(m => m[0]);
  const gtNums = new Set([...groundTruth.matchAll(numericPattern)].map(m => m[0]));
  const ctxNums = new Set([...contextSnippet.matchAll(numericPattern)].map(m => m[0]));
  for (const n of responseNums) {
    if (!gtNums.has(n) && !ctxNums.has(n)) return 0;
  }
  return 1;
}

function buildContext(sourceText: string, question: string): string {
  // Find the most relevant chunk in the source text using keyword proximity
  const words = normalize(question).split(/\s+/).filter(w => w.length > 4);
  let bestIdx = 0;
  let bestScore = -1;
  const step = 1000;
  for (let i = 0; i < sourceText.length - CONTEXT_CHARS; i += step) {
    const chunk = normalize(sourceText.slice(i, i + CONTEXT_CHARS));
    const score = words.filter(w => chunk.includes(w)).length;
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }
  return sourceText.slice(bestIdx, bestIdx + CONTEXT_CHARS);
}

async function callOllama(
  model: string,
  prompt: string,
): Promise<{ text: string; latencyMs: number }> {
  const started = Date.now();
  const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: { temperature: TEMPERATURE, num_predict: NUM_PREDICT },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama request failed (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as { response?: string; error?: string };
  if (payload.error) throw new Error(`Ollama error: ${payload.error}`);

  return {
    text: (payload.response ?? '').trim(),
    latencyMs: Date.now() - started,
  };
}

function buildPrompt(question: QuestionEntry, ctx: string): string {
  if (question.type === 'unanswerable') {
    return [
      'You are a precise document analyst. Answer ONLY from the provided context.',
      'If the answer is not present in the context, respond with:',
      '  "Not found in provided context."',
      'Do NOT fabricate information.',
      '',
      'Context:',
      ctx,
      '',
      `Question: ${question.question}`,
      'Answer:',
    ].join('\n');
  }

  return [
    'You are a precise document analyst. Answer ONLY from the provided context.',
    'Give a concise, factual answer. Include specific numbers when relevant.',
    'If the answer is not present, say "Not found in provided context."',
    '',
    'Context:',
    ctx,
    '',
    `Question: ${question.question}`,
    'Answer:',
  ].join('\n');
}

function scoreResult(
  question: QuestionEntry,
  response: string,
  latencyMs: number,
  contextSnippet: string,
  model: string,
): QuestionResult {
  const kr  = keywordRecall(response, question.keywords);
  const ra  = refusalAccuracy(response, question.type);
  const al  = answerLengthOk(response);
  const nh  = noHallucination(response, question.ground_truth, contextSnippet);

  const metrics: MetricScores = {
    keyword_recall: kr,
    refusal_accuracy: ra,
    answer_length_ok: al,
    no_hallucination: nh,
  };

  // For unanswerable questions, keyword_recall is replaced by refusal_accuracy
  // in the composite so that a correct refusal still scores well.
  const effectiveKR = question.type === 'unanswerable' ? ra : kr;
  const composite = Number(((effectiveKR + ra + al + nh) / 4).toFixed(3));
  const pass = composite >= 0.5 && nh === 1;

  let failureReason = 'none';
  const failures: string[] = [];
  if (nh === 0) failures.push('hallucinated number not in source');
  if (question.type === 'unanswerable' && ra === 0) failures.push('failed to refuse unanswerable question');
  if (question.type !== 'unanswerable' && kr < 0.5) failures.push(`low keyword recall (${kr})`);
  if (al === 0) failures.push('answer empty or too long');
  if (failures.length > 0) failureReason = failures.join('; ');

  return {
    question_id: question.id,
    model,
    question: question.question,
    type: question.type,
    difficulty: question.difficulty,
    source: question.source,
    response: response.slice(0, 600),
    latency_ms: latencyMs,
    metrics,
    composite_score: composite,
    pass,
    failure_reason: failureReason,
  };
}

async function runModel(
  model: string,
  questions: QuestionEntry[],
  jpmText: string,
  jnjText: string,
): Promise<QuestionResult[]> {
  console.log(`\n▶ Running model: ${model}`);
  const results: QuestionResult[] = [];

  for (const q of questions) {
    process.stdout.write(`  ${q.id} (${q.source})... `);

    let sourceText = '';
    if (q.source === 'JPM') sourceText = jpmText;
    else if (q.source === 'JNJ') sourceText = jnjText;
    else sourceText = jpmText.slice(0, CONTEXT_CHARS / 2) + '\n' + jnjText.slice(0, CONTEXT_CHARS / 2);

    const ctx = q.source === 'NONE'
      ? 'No relevant context found in the provided documents.'
      : buildContext(sourceText, q.question);

    const prompt = buildPrompt(q, ctx);
    const { text, latencyMs } = await callOllama(model, prompt);
    const result = scoreResult(q, text, latencyMs, ctx, model);

    console.log(`${result.pass ? '✓' : '✗'} composite=${result.composite_score}`);
    results.push(result);
  }

  return results;
}

// ── Markdown builders ─────────────────────────────────────────────────────────

function modelSummary(results: QuestionResult[]): {
  passed: number; failed: number; avgComposite: number;
  avgKR: number; avgRA: number; avgAL: number; avgNH: number;
  avgLatency: number;
} {
  const passed  = results.filter(r => r.pass).length;
  const failed  = results.length - passed;
  const avg = (getter: (r: QuestionResult) => number) =>
    Number((results.reduce((s, r) => s + getter(r), 0) / results.length).toFixed(3));

  return {
    passed, failed,
    avgComposite: avg(r => r.composite_score),
    avgKR:  avg(r => r.metrics.keyword_recall),
    avgRA:  avg(r => r.metrics.refusal_accuracy),
    avgAL:  avg(r => r.metrics.answer_length_ok),
    avgNH:  avg(r => r.metrics.no_hallucination),
    avgLatency: Math.round(results.reduce((s, r) => s + r.latency_ms, 0) / results.length),
  };
}

function buildMarkdown(output: EvalOutput): string {
  const lines: string[] = [];
  const smA = modelSummary(output.results_a);
  const smB = modelSummary(output.results_b);

  lines.push('# PDF Evaluation Report: LLM-A vs LLM-B');
  lines.push('');
  lines.push(`- Run date: ${output.run_date}`);
  lines.push(`- LLM-A: ${output.model_a}`);
  lines.push(`- LLM-B: ${output.model_b}`);
  lines.push(`- Temperature: ${output.temperature} (deterministic)`);
  lines.push(`- Total questions: ${output.results_a.length} (20 answerable + 5 unanswerable)`);
  lines.push(`- Source PDFs: JPMorgan Chase 2024 Annual Report (372 pages), Johnson & Johnson 2024 Annual Report (140 pages)`);
  lines.push('');

  // ── Section 1: Metric comparison table
  lines.push('## Section 1 — Results Table: LLM-A vs LLM-B on 4 Metrics');
  lines.push('');
  lines.push('| Metric | LLM-A | LLM-B | Winner |');
  lines.push('|---|---:|---:|---|');

  function winner(a: number, b: number): string {
    if (a > b) return `LLM-A (${output.model_a})`;
    if (b > a) return `LLM-B (${output.model_b})`;
    return 'Tie';
  }

  lines.push(`| Keyword Recall (avg) | ${smA.avgKR} | ${smB.avgKR} | ${winner(smA.avgKR, smB.avgKR)} |`);
  lines.push(`| Refusal Accuracy (avg) | ${smA.avgRA} | ${smB.avgRA} | ${winner(smA.avgRA, smB.avgRA)} |`);
  lines.push(`| Answer Length OK (avg) | ${smA.avgAL} | ${smB.avgAL} | ${winner(smA.avgAL, smB.avgAL)} |`);
  lines.push(`| No-Hallucination Rate (avg) | ${smA.avgNH} | ${smB.avgNH} | ${winner(smA.avgNH, smB.avgNH)} |`);
  lines.push(`| **Composite Score (avg)** | **${smA.avgComposite}** | **${smB.avgComposite}** | **${winner(smA.avgComposite, smB.avgComposite)}** |`);
  lines.push(`| Avg Latency (ms) | ${smA.avgLatency} | ${smB.avgLatency} | ${smA.avgLatency < smB.avgLatency ? `LLM-A (${output.model_a})` : `LLM-B (${output.model_b})`} |`);

  lines.push('');

  // Per-question comparison
  lines.push('### Per-Question Comparison');
  lines.push('');
  lines.push('| Q | Type | Difficulty | LLM-A Score | LLM-A Pass | LLM-B Score | LLM-B Pass |');
  lines.push('|---|---|---|---:|:---:|---:|:---:|');

  for (let i = 0; i < output.results_a.length; i++) {
    const ra = output.results_a[i];
    const rb = output.results_b[i];
    if (!ra || !rb) continue;
    lines.push(
      `| ${ra.question_id} | ${ra.type} | ${ra.difficulty} | ${ra.composite_score} | ${ra.pass ? '✓' : '✗'} | ${rb.composite_score} | ${rb.pass ? '✓' : '✗'} |`,
    );
  }
  lines.push('');

  // ── Section 2: Pass/Fail summary
  lines.push('## Section 2 — Pass/Fail Summary');
  lines.push('');
  lines.push('| Model | Passed | Failed | Pass Rate |');
  lines.push('|---|---:|---:|---:|');
  lines.push(`| LLM-A (${output.model_a}) | ${smA.passed} | ${smA.failed} | ${Number((smA.passed / output.results_a.length * 100).toFixed(1))}% |`);
  lines.push(`| LLM-B (${output.model_b}) | ${smB.passed} | ${smB.failed} | ${Number((smB.passed / output.results_b.length * 100).toFixed(1))}% |`);
  lines.push('');

  lines.push('### LLM-A Per-Category Pass Rate');
  lines.push('');
  const types = ['factual', 'synthesis', 'unanswerable'];
  lines.push('| Type | Passed | Total | Pass Rate |');
  lines.push('|---|---:|---:|---:|');
  for (const t of types) {
    const sub = output.results_a.filter(r => r.type === t);
    const p = sub.filter(r => r.pass).length;
    lines.push(`| ${t} | ${p} | ${sub.length} | ${Number((p / (sub.length || 1) * 100).toFixed(1))}% |`);
  }
  lines.push('');

  lines.push('### LLM-B Per-Category Pass Rate');
  lines.push('');
  lines.push('| Type | Passed | Total | Pass Rate |');
  lines.push('|---|---:|---:|---:|');
  for (const t of types) {
    const sub = output.results_b.filter(r => r.type === t);
    const p = sub.filter(r => r.pass).length;
    lines.push(`| ${t} | ${p} | ${sub.length} | ${Number((p / (sub.length || 1) * 100).toFixed(1))}% |`);
  }
  lines.push('');

  // ── Section 3: Top 5 failures
  lines.push('## Section 3 — Top 5 Failure Examples');
  lines.push('');
  lines.push('Failures are ranked by lowest composite score across both models.');
  lines.push('');

  // Combine and sort failures
  const allFailures = [
    ...output.results_a.filter(r => !r.pass),
    ...output.results_b.filter(r => !r.pass),
  ].sort((a, b) => a.composite_score - b.composite_score);

  const top5 = allFailures.slice(0, 5);

  lines.push('| # | Q | Model | Composite | 1-line Reason |');
  lines.push('|---|---|---|---:|---|');
  top5.forEach((r, i) => {
    lines.push(`| ${i + 1} | ${r.question_id} | ${r.model} | ${r.composite_score} | ${r.failure_reason} |`);
  });
  lines.push('');

  // Detailed failure excerpts
  lines.push('### Failure Details');
  lines.push('');
  top5.forEach((r, i) => {
    lines.push(`#### Failure ${i + 1}: ${r.question_id} (${r.model})`);
    lines.push(`- **Question:** ${r.question}`);
    lines.push(`- **Type / Difficulty:** ${r.type} / ${r.difficulty}`);
    lines.push(`- **Reason:** ${r.failure_reason}`);
    lines.push(`- **Response preview:** ${r.response.slice(0, 260).replace(/\n/g, ' ')}...`);
    lines.push('');
  });

  // ── Section 4: Test set listing
  lines.push('## Section 4 — Test Set (25 Questions with Ground Truth)');
  lines.push('');
  lines.push('| # | Source | Type | Question | Ground Truth |');
  lines.push('|---:|---|---|---|---|');

  const allQ = output.results_a.map(r => ({ id: r.question_id, source: r.source, type: r.type, q: r.question }));
  const testSet = JSON.parse(readFileSync(TEST_SET_PATH, 'utf-8')) as TestSet;
  for (const q of testSet.questions) {
    const gt = q.ground_truth.replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const qTxt = q.question.replace(/\|/g, '\\|');
    lines.push(`| ${q.id} | ${q.source} | ${q.type} | ${qTxt} | ${gt} |`);
  }
  lines.push('');

  return lines.join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('Loading test set and PDF text...');

  const testSet = JSON.parse(readFileSync(TEST_SET_PATH, 'utf-8')) as TestSet;
  const jpmText = readFileSync(JPM_TEXT_PATH, 'utf-8');
  const jnjText = readFileSync(JNJ_TEXT_PATH, 'utf-8');

  console.log(`Test set: ${testSet.questions.length} questions`);
  console.log(`JPM text: ${jpmText.length} chars`);
  console.log(`JNJ text: ${jnjText.length} chars`);
  console.log(`Model A: ${MODEL_A}  |  Model B: ${MODEL_B}`);
  console.log(`Temperature: ${TEMPERATURE}`);

  const resultsA = await runModel(MODEL_A, testSet.questions, jpmText, jnjText);
  const resultsB = await runModel(MODEL_B, testSet.questions, jpmText, jnjText);

  const output: EvalOutput = {
    run_date: new Date().toISOString(),
    model_a: MODEL_A,
    model_b: MODEL_B,
    temperature: TEMPERATURE,
    results_a: resultsA,
    results_b: resultsB,
  };

  mkdirSync(resolve(process.cwd(), 'docs'), { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(output, null, 2));
  console.log(`\nJSON results written to ${OUT_JSON}`);

  const md = buildMarkdown(output);
  writeFileSync(OUT_MD, md);
  console.log(`Markdown report written to ${OUT_MD}`);

  // Quick summary to console
  const smA = modelSummary(resultsA);
  const smB = modelSummary(resultsB);
  console.log('\n=== Summary ===');
  console.log(`LLM-A (${MODEL_A}): ${smA.passed}/${resultsA.length} pass, composite avg ${smA.avgComposite}`);
  console.log(`LLM-B (${MODEL_B}): ${smB.passed}/${resultsB.length} pass, composite avg ${smB.avgComposite}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
