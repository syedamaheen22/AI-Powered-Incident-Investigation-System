import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ChatOllama } from "@langchain/ollama";

type Temperature = 0 | 0.7 | 1;

interface PromptCase {
  id: string;
  title: string;
  prompt: string;
}

interface RunResult {
  promptId: string;
  promptTitle: string;
  temperature: Temperature;
  responseText: string;
  outputTokens: number | null;
  latencyMs: number;
  wordCount: number;
  charCount: number;
}

const TEMPERATURES: Temperature[] = [0, 0.7, 1];
const MODEL = process.env.OLLAMA_MODEL ?? 'llama3';
const NUM_PREDICT = Number(process.env.OLLAMA_NUM_PREDICT ?? '220');

const PROMPTS: PromptCase[] = [
  {
    id: 'p1',
    title: 'Simple explanation',
    prompt: 'Explain recursion to a 12-year-old in exactly 3 short bullet points.',
  },
  {
    id: 'p2',
    title: 'Rewrite style',
    prompt:
      'Rewrite this sentence in a professional tone while keeping it short: "our app keeps crashing and users are angry".',
  },
  {
    id: 'p3',
    title: 'Debug suggestion',
    prompt:
      'A Node.js app memory usage grows over time. Give 5 practical debugging steps in priority order.',
  },
  {
    id: 'p4',
    title: 'Marketing copy',
    prompt: 'Write a 4-line landing page hero copy for a weather-based shopping app.',
  },
  {
    id: 'p5',
    title: 'SQL reasoning',
    prompt:
      'Given users(id, city) and orders(id, user_id, amount), write SQL to find top 3 cities by total order amount.',
  },
  {
    id: 'p6',
    title: 'Test case design',
    prompt: 'Create 6 edge-case test ideas for a checkout form with card payment.',
  },
  {
    id: 'p7',
    title: 'Summarization',
    prompt:
      'Summarize this in one sentence: "Temperature-aware shopping improves relevance by linking weather context with product suggestions."',
  },
  {
    id: 'p8',
    title: 'Creative variant',
    prompt: 'Give 5 alternative names for a smart sunscreen recommendation feature.',
  },
  {
    id: 'p9',
    title: 'Instruction following',
    prompt: 'Respond with JSON only: keys reason, action, confidence for choosing moisturizers in cold weather.',
  },
  {
    id: 'p10',
    title: 'Tradeoff analysis',
    prompt:
      'Compare rule-based agents and LLM-based agents in 4 concise bullets focusing on reliability and flexibility.',
  },
];

function countWords(text: string): number {
  const words = text.trim().match(/\b[\w'-]+\b/g);
  return words ? words.length : 0;
}

function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return new Set(tokens);
}

function jaccardSimilarity(a: string, b: string): number {
  const aTokens = tokenize(a);
  const bTokens = tokenize(b);

  if (aTokens.size === 0 && bTokens.size === 0) {
    return 1;
  }

  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) {
      intersection += 1;
    }
  }

  const union = aTokens.size + bTokens.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function escapeMd(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

async function callModel(prompt: string, temperature: Temperature): Promise<{ text: string; outputTokens: number | null; latencyMs: number }> {
  const llm = new ChatOllama({
    model: MODEL,
    temperature,
    numPredict: NUM_PREDICT,
  });

  const start = Date.now();
  const response = await llm.invoke(prompt);
  const text = typeof response.content === 'string' ? response.content.trim() : '';
  const latencyMs = Date.now() - start;
  const outputTokens =
    response.response_metadata &&
    typeof response.response_metadata === 'object' &&
    'eval_count' in response.response_metadata &&
    typeof (response.response_metadata as { eval_count?: unknown }).eval_count === 'number'
      ? ((response.response_metadata as { eval_count: number }).eval_count as number)
      : null;

  return {
    text,
    outputTokens,
    latencyMs,
  };
}

function summarizeByTemperature(results: RunResult[]): Array<{ temperature: Temperature; avgWords: number; avgChars: number; avgLatencyMs: number }> {
  return TEMPERATURES.map((temperature) => {
    const slice = results.filter((r) => r.temperature === temperature);
    const avgWords = slice.reduce((sum, r) => sum + r.wordCount, 0) / slice.length;
    const avgChars = slice.reduce((sum, r) => sum + r.charCount, 0) / slice.length;
    const avgLatencyMs = slice.reduce((sum, r) => sum + r.latencyMs, 0) / slice.length;

    return {
      temperature,
      avgWords: Number(avgWords.toFixed(1)),
      avgChars: Number(avgChars.toFixed(1)),
      avgLatencyMs: Number(avgLatencyMs.toFixed(1)),
    };
  });
}

function summarizePromptDiversity(results: RunResult[]): Array<{ promptId: string; promptTitle: string; avgPairSimilarity: number }> {
  return PROMPTS.map((promptCase) => {
    const promptResults = results.filter((r) => r.promptId === promptCase.id);
    const output0 = promptResults.find((r) => r.temperature === 0)?.responseText ?? '';
    const output07 = promptResults.find((r) => r.temperature === 0.7)?.responseText ?? '';
    const output1 = promptResults.find((r) => r.temperature === 1)?.responseText ?? '';

    const pairs = [
      jaccardSimilarity(output0, output07),
      jaccardSimilarity(output0, output1),
      jaccardSimilarity(output07, output1),
    ];

    const avgPairSimilarity = pairs.reduce((sum, value) => sum + value, 0) / pairs.length;
    return {
      promptId: promptCase.id,
      promptTitle: promptCase.title,
      avgPairSimilarity: Number(avgPairSimilarity.toFixed(3)),
    };
  });
}

function buildComparisonMarkdown(results: RunResult[]): string {
  const byTemperature = summarizeByTemperature(results);
  const diversity = summarizePromptDiversity(results);

  const lines: string[] = [];
  lines.push('# LLM Temperature Comparison Report');
  lines.push('');
  lines.push(`- Date: ${new Date().toISOString()}`);
  lines.push(`- Model: ${MODEL}`);
  lines.push(`- Runs: ${PROMPTS.length} prompts x ${TEMPERATURES.length} temperatures = ${results.length}`);
  lines.push(`- Temperatures: ${TEMPERATURES.join(', ')}`);
  lines.push('');

  lines.push('## Aggregate Metrics by Temperature');
  lines.push('');
  lines.push('| Temperature | Avg Words | Avg Chars | Avg Latency (ms) |');
  lines.push('|---|---:|---:|---:|');
  for (const row of byTemperature) {
    lines.push(`| ${row.temperature} | ${row.avgWords} | ${row.avgChars} | ${row.avgLatencyMs} |`);
  }
  lines.push('');

  lines.push('## Prompt-Level Diversity (Lower Similarity = More Variation)');
  lines.push('');
  lines.push('| Prompt | Avg Pair Similarity |');
  lines.push('|---|---:|');
  for (const row of diversity) {
    lines.push(`| ${row.promptId} - ${escapeMd(row.promptTitle)} | ${row.avgPairSimilarity} |`);
  }
  lines.push('');

  lines.push('## Output Samples by Prompt and Temperature');
  lines.push('');

  for (const promptCase of PROMPTS) {
    lines.push(`### ${promptCase.id}: ${promptCase.title}`);
    lines.push('');
    lines.push(`Prompt: ${promptCase.prompt}`);
    lines.push('');
    lines.push('| Temp | Words | Chars | Output Tokens | Latency (ms) | Output Preview |');
    lines.push('|---|---:|---:|---:|---:|---|');

    const promptResults = results
      .filter((r) => r.promptId === promptCase.id)
      .sort((a, b) => a.temperature - b.temperature);

    for (const run of promptResults) {
      const preview = escapeMd(run.responseText.slice(0, 220));
      const outputTokens = run.outputTokens === null ? 'n/a' : String(run.outputTokens);
      lines.push(`| ${run.temperature} | ${run.wordCount} | ${run.charCount} | ${outputTokens} | ${run.latencyMs} | ${preview} |`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

function buildCheatsheetMarkdown(results: RunResult[]): string {
  const byTemperature = summarizeByTemperature(results);
  const diversity = summarizePromptDiversity(results);

  const avgSimilarity = Number(
    (diversity.reduce((sum, row) => sum + row.avgPairSimilarity, 0) / diversity.length).toFixed(3),
  );

  const lines: string[] = [];
  lines.push('# LLM Behavior Cheatsheet');
  lines.push('');
  lines.push('This cheatsheet summarizes what changed when running 10 prompts at temperature 0, 0.7, and 1.');
  lines.push('');
  lines.push('## What Changes Output (and Why)');
  lines.push('');
  lines.push('1. Temperature');
  lines.push('Higher temperature increases randomness during token sampling, so wording and structure vary more between runs.');
  lines.push('2. Prompt specificity');
  lines.push('Tight constraints (for example, exact bullet count or JSON-only) reduce variation because the model has fewer valid outputs.');
  lines.push('3. Output length limits');
  lines.push('Lower max output tokens forces concise answers and can truncate elaboration, reducing perceived creativity.');
  lines.push('4. Model choice');
  lines.push('Different models use different training, alignment, and decoding defaults, which shifts style, depth, and consistency.');
  lines.push('5. Hidden context and instruction hierarchy');
  lines.push('System/developer instructions and conversation history strongly shape outputs even when user prompts are identical.');
  lines.push('');
  lines.push('## Observed in This Assignment');
  lines.push('');
  lines.push('| Temperature | Avg Words | Avg Chars | Avg Latency (ms) |');
  lines.push('|---|---:|---:|---:|');
  for (const row of byTemperature) {
    lines.push(`| ${row.temperature} | ${row.avgWords} | ${row.avgChars} | ${row.avgLatencyMs} |`);
  }
  lines.push('');
  lines.push(`- Mean lexical similarity across temperature outputs: ${avgSimilarity}`);
  lines.push('- Lower similarity indicates higher variation in wording and phrasing.');
  lines.push('');
  lines.push('## Practical Temperature Guide');
  lines.push('');
  lines.push('- Temp 0: Use for deterministic tasks (tests, strict transformations, reproducible outputs).');
  lines.push('- Temp 0.7: Use for balanced quality and creativity (most product and assistant writing).');
  lines.push('- Temp 1: Use for brainstorming and alternatives where novelty matters more than consistency.');
  lines.push('');
  lines.push('## Recommendation for Reports');
  lines.push('');
  lines.push('- If the assignment asks for reliability, use temp 0 with strict prompt constraints.');
  lines.push('- If the assignment asks for creativity comparison, include temp 1 examples side by side with temp 0.');
  lines.push('- Always log prompt, model, temperature, and token limits for reproducibility.');

  return lines.join('\n');
}

async function main(): Promise<void> {
  console.log(`Running assignment with model ${MODEL}...`);
  const results: RunResult[] = [];

  for (const promptCase of PROMPTS) {
    for (const temperature of TEMPERATURES) {
      console.log(`Prompt ${promptCase.id} at temperature ${temperature}`);

      const output = await callModel(promptCase.prompt, temperature);
      const result: RunResult = {
        promptId: promptCase.id,
        promptTitle: promptCase.title,
        temperature,
        responseText: output.text,
        outputTokens: output.outputTokens,
        latencyMs: output.latencyMs,
        wordCount: countWords(output.text),
        charCount: output.text.length,
      };

      results.push(result);
    }
  }

  const docsPath = resolve(process.cwd(), 'docs', 'day1');
  mkdirSync(docsPath, { recursive: true });

  const reportPath = resolve(docsPath, 'LLM_TEMPERATURE_COMPARISON.md');
  const cheatsheetPath = resolve(docsPath, 'LLM_BEHAVIOR_CHEATSHEET.md');
  const rawPath = resolve(docsPath, 'llm-run-results.json');

  writeFileSync(rawPath, JSON.stringify(results, null, 2), 'utf-8');
  writeFileSync(reportPath, buildComparisonMarkdown(results), 'utf-8');
  writeFileSync(cheatsheetPath, buildCheatsheetMarkdown(results), 'utf-8');

  console.log('Assignment completed. Files generated:');
  console.log(`- ${rawPath}`);
  console.log(`- ${reportPath}`);
  console.log(`- ${cheatsheetPath}`);
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
});
