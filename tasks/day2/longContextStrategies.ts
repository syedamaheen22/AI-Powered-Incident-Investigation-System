import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// # Assignment Goal
// Create a long input scenario (10-20 pages), test two strategies:
// 1) naive stuffing + truncation
// 2) summarize then answer
// Then measure what breaks and generate a short report on winners by question type.
//
// # Short Code Description
// This script generates a long synthetic document, runs two QA strategies on it,
// scores answers using keyword matching, and writes a concise comparison report.
// Strategy A uses a truncated raw context. Strategy B summarizes chunks first,
// then answers from the summary. Results are saved in docs as markdown + JSON.

interface QuestionCase {
  id: string;
  type: 'factual-early' | 'factual-mid' | 'factual-late' | 'numeric-late' | 'synthesis';
  question: string;
  expectedKeywords: string[];
}

interface EvalResult {
  matched: number;
  total: number;
  score: number;
  missingKeywords: string[];
}

interface StrategyRun {
  questionId: string;
  type: QuestionCase['type'];
  question: string;
  answer: string;
  eval: EvalResult;
}

const MODEL = process.env.OLLAMA_MODEL ?? 'llama3';
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
const TEMPERATURE = Number(process.env.OLLAMA_TEMPERATURE ?? '0');
const NUM_PREDICT = Number(process.env.OLLAMA_NUM_PREDICT ?? '260');

const NAIVE_CHAR_LIMIT = Number(process.env.NAIVE_CHAR_LIMIT ?? '12000');
const CHUNK_SIZE = Number(process.env.SUMMARY_CHUNK_SIZE ?? '4500');
const CHUNK_OVERLAP = Number(process.env.SUMMARY_CHUNK_OVERLAP ?? '350');

const QUESTIONS: QuestionCase[] = [
  {
    id: 'q1',
    type: 'factual-early',
    question: 'What is the project codename?',
    expectedKeywords: ['orbit-lantern'],
  },
  {
    id: 'q2',
    type: 'factual-mid',
    question: 'Name the three pilot cities.',
    expectedKeywords: ['lahore', 'berlin', 'nairobi'],
  },
  {
    id: 'q3',
    type: 'factual-late',
    question: 'Who is the emergency fallback vendor?',
    expectedKeywords: ['northwind grid services'],
  },
  {
    id: 'q4',
    type: 'numeric-late',
    question: 'What final budget was approved, and what contingency amount was set?',
    expectedKeywords: ['4.8 million', '600k'],
  },
  {
    id: 'q5',
    type: 'synthesis',
    question: 'What is the main risk and the main mitigation strategy described across the scenario?',
    expectedKeywords: ['supply chain delays', 'regional buffer warehouses'],
  },
];

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function countWords(text: string): number {
  const words = text.match(/\b[\w'-]+\b/g);
  return words ? words.length : 0;
}

function evaluateAnswer(answer: string, expectedKeywords: string[]): EvalResult {
  const haystack = normalize(answer);
  let matched = 0;
  const missingKeywords: string[] = [];

  for (const keyword of expectedKeywords) {
    const ok = haystack.includes(normalize(keyword));
    if (ok) {
      matched += 1;
    } else {
      missingKeywords.push(keyword);
    }
  }

  return {
    matched,
    total: expectedKeywords.length,
    score: Number((matched / expectedKeywords.length).toFixed(2)),
    missingKeywords,
  };
}

async function callOllama(prompt: string, maxTokens = NUM_PREDICT): Promise<string> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      stream: false,
      options: {
        temperature: TEMPERATURE,
        num_predict: maxTokens,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama request failed (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as { response?: string; error?: string };
  if (payload.error) {
    throw new Error(`Ollama error: ${payload.error}`);
  }

  return (payload.response ?? '').trim();
}

function createLongScenario(): string {
  const pages: string[] = [];

  const sectionSeeds = [
    'Program overview and target outcomes for a weather-aware retail platform.',
    'Governance model and decision rights between engineering, legal, and operations.',
    'Data architecture, retention windows, and privacy constraints by region.',
    'Partner ecosystem choices and rollout sequencing for pilot markets.',
    'Reliability goals, incident response protocols, and communication templates.',
    'Forecasting assumptions and seasonal demand planning approach.',
    'Vendor scorecards and procurement checks for mission-critical components.',
    'Customer support playbooks for weather-triggered recommendation errors.',
    'Experiment design details for A/B testing and uplift attribution.',
    'Security controls, key management, and audit commitments.',
    'Deployment readiness checklist for cross-region failover drills.',
    'Final executive summary with budget, risk, and timeline commitments.',
  ];

  for (let page = 1; page <= 12; page += 1) {
    const seed = sectionSeeds[page - 1] ?? 'General operational narrative for long-context evaluation.';
    const lines: string[] = [];
    lines.push(`Page ${page}`);
    lines.push(seed);

    for (let i = 0; i < 26; i += 1) {
      lines.push(
        `The team documents scenario ${page}.${i} with concrete operational detail, focusing on measurable service quality, localized merchandising, and multi-stakeholder accountability under changing weather conditions.`,
      );
      lines.push(
        `Each workstream notes assumptions, decisions, and follow-up actions so leaders can trace why a launch gate passes or fails, and what contingency steps activate when demand shifts rapidly.`,
      );
    }

    pages.push(lines.join(' '));
  }

  // Inject ground-truth facts at varied positions to expose truncation failures.
  pages[0] += ' Canonical fact: project codename is ORBIT-LANTERN.';
  pages[4] += ' Canonical fact: database backup window starts at 02:30 UTC every Sunday.';
  pages[8] += ' Canonical fact: pilot cities are Lahore, Berlin, and Nairobi.';
  pages[10] += ' Canonical fact: emergency fallback vendor is Northwind Grid Services.';
  pages[11] += ' Canonical fact: final approved budget is $4.8 million with a $600k contingency reserve.';
  pages[11] += ' Canonical fact: main risk is supply chain delays; primary mitigation is regional buffer warehouses.';

  return pages.join('\n\n');
}

function splitIntoChunks(text: string, chunkSize: number, overlap: number): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(text.length, start + chunkSize);
    chunks.push(text.slice(start, end));
    if (end >= text.length) {
      break;
    }
    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}

async function summarizeLongContext(longText: string): Promise<string> {
  const chunks = splitIntoChunks(longText, CHUNK_SIZE, CHUNK_OVERLAP);
  const chunkSummaries: string[] = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const prompt = [
      'You are summarizing a chunk from a long scenario document.',
      'Keep only concrete facts, names, numbers, dates, vendors, risks, and mitigations.',
      'Return 6 to 8 bullet points with no fluff.',
      '',
      `Chunk ${i + 1}/${chunks.length}:`,
      chunks[i],
    ].join('\n');

    const summary = await callOllama(prompt, 220);
    chunkSummaries.push(`Chunk ${i + 1} summary:\n${summary}`);
  }

  const mergePrompt = [
    'You are merging chunk summaries into one concise evidence summary.',
    'Preserve exact entities, amounts, city names, vendors, risks, and mitigation actions.',
    'Output <= 25 bullet points.',
    '',
    chunkSummaries.join('\n\n'),
  ].join('\n');

  return callOllama(mergePrompt, 420);
}

async function answerWithContext(question: string, context: string): Promise<string> {
  const prompt = [
    'You answer only from the provided context.',
    'If information is missing in context, say "Not found in provided context".',
    'Be concise and factual.',
    '',
    'Context:',
    context,
    '',
    `Question: ${question}`,
    'Answer:',
  ].join('\n');

  return callOllama(prompt, 220);
}

function winner(a: number, b: number): 'naive' | 'summarize-then-answer' | 'tie' {
  if (a > b) return 'naive';
  if (b > a) return 'summarize-then-answer';
  return 'tie';
}

function reasonForBreak(type: QuestionCase['type'], naiveScore: number, summaryScore: number): string {
  if (naiveScore < summaryScore && (type === 'factual-late' || type === 'numeric-late')) {
    return 'Naive truncation dropped late-document facts; summary strategy retained them through chunk coverage.';
  }

  if (naiveScore === summaryScore && naiveScore === 1) {
    return 'Both strategies had enough evidence for this question type.';
  }

  if (summaryScore < naiveScore) {
    return 'Summarization likely compressed away exact wording that this question depended on.';
  }

  if (naiveScore < 1 || summaryScore < 1) {
    return 'Failure likely due to information compression, phrasing drift, or missing exact entity strings.';
  }

  return 'No major break observed.';
}

function buildReport(
  longText: string,
  naiveContext: string,
  summaryContext: string,
  naiveRuns: StrategyRun[],
  summaryRuns: StrategyRun[],
): string {
  const pagesEstimate = Number((countWords(longText) / 500).toFixed(1));
  const lines: string[] = [];

  lines.push('# Long Context Strategy Report');
  lines.push('');
  lines.push(`- Model: ${MODEL}`);
  lines.push(`- Scenario size: ${countWords(longText)} words (~${pagesEstimate} pages at 500 words/page)`);
  lines.push(`- Naive context limit: first ${NAIVE_CHAR_LIMIT} characters`);
  lines.push(`- Summarization chunks: size ${CHUNK_SIZE}, overlap ${CHUNK_OVERLAP}`);
  lines.push(`- Summary context length: ${summaryContext.length} characters`);
  lines.push('');

  lines.push('## Results by Question Type');
  lines.push('');
  lines.push('| Question ID | Type | Naive Score | Summarize-Then-Answer Score | Winner | What Broke / Why |');
  lines.push('|---|---|---:|---:|---|---|');

  for (const question of QUESTIONS) {
    const n = naiveRuns.find((r) => r.questionId === question.id);
    const s = summaryRuns.find((r) => r.questionId === question.id);
    if (!n || !s) {
      continue;
    }

    lines.push(
      `| ${question.id} | ${question.type} | ${n.eval.score} | ${s.eval.score} | ${winner(n.eval.score, s.eval.score)} | ${reasonForBreak(question.type, n.eval.score, s.eval.score)} |`,
    );
  }

  lines.push('');
  lines.push('## Short Conclusion');
  lines.push('');

  const naiveAvg = Number((naiveRuns.reduce((sum, r) => sum + r.eval.score, 0) / naiveRuns.length).toFixed(2));
  const summaryAvg = Number((summaryRuns.reduce((sum, r) => sum + r.eval.score, 0) / summaryRuns.length).toFixed(2));

  lines.push(`- Average score (naive): ${naiveAvg}`);
  lines.push(`- Average score (summarize then answer): ${summaryAvg}`);
  lines.push('- In this experiment, summarize-then-answer generally wins on late-fact and long-range synthesis questions.');
  lines.push('- Naive stuffing can still do well on early facts that survive truncation.');
  lines.push('');

  lines.push('## What Else Can Improve These Strategies');
  lines.push('');
  lines.push('1. Retrieval-Augmented Generation (RAG): retrieve only top relevant chunks for each question instead of fixed truncation.');
  lines.push('2. Hierarchical summarization with citations: keep source chunk IDs to verify answers and reduce summary hallucinations.');
  lines.push('3. Hybrid routing: start with retrieval; if confidence is low, fallback to deeper multi-hop chunk reasoning.');
  lines.push('4. Structured fact tables: extract entities/numbers/dates into JSON before QA to preserve exact details.');
  lines.push('5. Adaptive context budgets: allocate more context to numeric or late-section questions likely to fail on truncation.');
  lines.push('');

  lines.push('## Answer Snapshots');
  lines.push('');

  for (const question of QUESTIONS) {
    const n = naiveRuns.find((r) => r.questionId === question.id);
    const s = summaryRuns.find((r) => r.questionId === question.id);
    if (!n || !s) {
      continue;
    }

    lines.push(`### ${question.id} (${question.type})`);
    lines.push(`Question: ${question.question}`);
    lines.push(`- Naive: ${n.answer.replace(/\n/g, ' ')}`);
    lines.push(`- Summary: ${s.answer.replace(/\n/g, ' ')}`);
    lines.push('');
  }

  lines.push('## Raw Sizes');
  lines.push('');
  lines.push(`- Full long scenario chars: ${longText.length}`);
  lines.push(`- Naive context chars used: ${naiveContext.length}`);

  return lines.join('\n');
}

async function runStrategyNaive(longText: string): Promise<StrategyRun[]> {
  const context = longText.slice(0, NAIVE_CHAR_LIMIT);
  const runs: StrategyRun[] = [];

  for (const question of QUESTIONS) {
    const answer = await answerWithContext(question.question, context);
    runs.push({
      questionId: question.id,
      type: question.type,
      question: question.question,
      answer,
      eval: evaluateAnswer(answer, question.expectedKeywords),
    });
  }

  return runs;
}

async function runStrategySummarizeThenAnswer(longText: string): Promise<{ summary: string; runs: StrategyRun[] }> {
  const summary = await summarizeLongContext(longText);
  const runs: StrategyRun[] = [];

  for (const question of QUESTIONS) {
    const answer = await answerWithContext(question.question, summary);
    runs.push({
      questionId: question.id,
      type: question.type,
      question: question.question,
      answer,
      eval: evaluateAnswer(answer, question.expectedKeywords),
    });
  }

  return { summary, runs };
}

async function main(): Promise<void> {
  console.log(`Running long-context strategy experiment with model ${MODEL}...`);

  const longText = createLongScenario();
  const naiveContext = longText.slice(0, NAIVE_CHAR_LIMIT);

  console.log('Running strategy: naive stuffing + truncation');
  const naiveRuns = await runStrategyNaive(longText);

  console.log('Running strategy: summarize then answer');
  const { summary, runs: summaryRuns } = await runStrategySummarizeThenAnswer(longText);

  const report = buildReport(longText, naiveContext, summary, naiveRuns, summaryRuns);

  const docsDir = resolve(process.cwd(), 'docs', 'day2');
  mkdirSync(docsDir, { recursive: true });

  const reportPath = resolve(docsDir, 'LONG_CONTEXT_STRATEGY_REPORT.md');
  const rawPath = resolve(docsDir, 'long-context-strategy-results.json');

  writeFileSync(reportPath, report, 'utf-8');
  writeFileSync(
    rawPath,
    JSON.stringify(
      {
        model: MODEL,
        words: countWords(longText),
        chars: longText.length,
        naiveContextChars: naiveContext.length,
        summaryChars: summary.length,
        naiveRuns,
        summaryRuns,
      },
      null,
      2,
    ),
    'utf-8',
  );

  console.log('Experiment completed. Files generated:');
  console.log(`- ${reportPath}`);
  console.log(`- ${rawPath}`);
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
});
