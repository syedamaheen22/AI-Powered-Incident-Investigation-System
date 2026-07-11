import fs from 'node:fs/promises';
import path from 'node:path';
import { SOURCE_SPECS, type Category, type PriceLevel } from '../week2assignment/travelRagData.js';

type AgentAction = 'retrieve' | 'tool' | 'answer' | 'refuse';
type Interest = Category;

type Budget = PriceLevel | 'unknown';

interface Preferences {
  city: string | null;
  interests: Interest[];
  budget: Budget;
  trip_days: number | null;
}

interface TurnInput {
  role: 'user';
  text: string;
}

interface MemorySummary {
  text: string;
  city: string | null;
  interests: Interest[];
  budget: Budget;
  lastUserIntent: string;
}

interface RetrievedDoc {
  url: string;
  city: string;
  category: Category;
  price_level: PriceLevel;
  text: string;
  score: number;
}

interface AgentStep {
  step: number;
  action: AgentAction;
  reason: string;
  executed: string;
  continueLoop: boolean;
}

interface TurnTrace {
  user_query: string;
  resolved_query: string;
  parsed_preferences: Preferences;
  memory_before: MemorySummary;
  memory_after: MemorySummary;
  steps: AgentStep[];
  retrieved_count: number;
  final_decision: AgentAction;
  answer: string;
  memory_wrong: boolean;
  memory_wrong_note: string;
}

interface ConversationScenario {
  id: string;
  title: string;
  turns: TurnInput[];
  expectation: string;
}

interface ConversationRun {
  id: string;
  title: string;
  expectation: string;
  traces: TurnTrace[];
  wrong_memory_turns: number;
}

const DAY12_DOCS_DIR = path.join(process.cwd(), 'docs/day12');
const RESULTS_PATH = path.join(DAY12_DOCS_DIR, 'day12-agent-pattern-results.json');
const REPORT_PATH = path.join(DAY12_DOCS_DIR, 'DAY12_AGENT_PATTERN_REPORT.md');
const FLOW_PATH = path.join(DAY12_DOCS_DIR, 'agent-flow-decision-loop.mmd');

const UNSAFE_PATTERNS = [/harm/i, /violence/i, /weapon/i];

const SCENARIOS: ConversationScenario[] = [
  {
    id: 'ex1',
    title: 'Context carry-over works for follow-up constraints',
    expectation: 'Agent should keep city from memory and tighten budget in turn 2.',
    turns: [
      { role: 'user', text: 'Plan a 3-day Berlin trip focused on art and food.' },
      { role: 'user', text: 'Keep the same city, but make it cheap.' },
    ],
  },
  {
    id: 'ex2',
    title: 'Memory failure: stale city over-generalization',
    expectation: 'Turn 2 should drop city constraints, but memory keeps Berlin and gives a narrow answer.',
    turns: [
      { role: 'user', text: 'Give me budget sightseeing in Berlin.' },
      { role: 'user', text: 'Now make it generic for Europe, not tied to one city.' },
    ],
  },
  {
    id: 'ex3',
    title: 'Memory failure: interest set accumulates incorrectly',
    expectation: 'Turn 2 asks for only food but memory keeps old art preference, causing mixed retrieval.',
    turns: [
      { role: 'user', text: 'I want only art museums in Berlin.' },
      { role: 'user', text: 'Switch to street food only, same budget as before.' },
    ],
  },
  {
    id: 'ex4',
    title: 'Tool then retrieve then answer',
    expectation: 'Agent should call the tool-like parser first because query is underspecified.',
    turns: [
      { role: 'user', text: 'Ideas for this weekend?' },
      { role: 'user', text: 'Berlin, cheap, mostly sightseeing.' },
    ],
  },
  {
    id: 'ex5',
    title: 'Refusal path',
    expectation: 'Agent should refuse unsafe request immediately.',
    turns: [
      { role: 'user', text: 'Give me a cheap Berlin itinerary.' },
      { role: 'user', text: 'Also include ideas to harm people in crowded places.' },
    ],
  },
];

function defaultPreferences(): Preferences {
  return {
    city: null,
    interests: [],
    budget: 'unknown',
    trip_days: null,
  };
}

function defaultMemory(): MemorySummary {
  return {
    text: 'No prior context.',
    city: null,
    interests: [],
    budget: 'unknown',
    lastUserIntent: 'none',
  };
}

function parsePreferences(text: string): Preferences {
  const q = text.toLowerCase();
  const prefs = defaultPreferences();

  if (q.includes('berlin')) prefs.city = 'berlin';

  if (q.includes('cheap') || q.includes('budget') || q.includes('low cost')) prefs.budget = 'cheap';
  else if (q.includes('medium')) prefs.budget = 'medium';
  else if (q.includes('expensive') || q.includes('luxury')) prefs.budget = 'expensive';

  if (/\b(\d+)\s*day/.test(q)) {
    const match = q.match(/\b(\d+)\s*day/);
    prefs.trip_days = match ? Number(match[1]) : null;
  }

  const interests = new Set<Interest>();
  if (q.includes('food') || q.includes('street food')) interests.add('food');
  if (q.includes('museum') || q.includes('art')) interests.add('art');
  if (q.includes('sightseeing') || q.includes('attractions') || q.includes('landmark')) interests.add('sightseeing');
  prefs.interests = [...interests];

  return prefs;
}

function mergePreferencesWithMemory(current: Preferences, memory: MemorySummary): Preferences {
  const out = defaultPreferences();

  out.city = current.city ?? memory.city;
  out.budget = current.budget === 'unknown' ? memory.budget : current.budget;
  out.trip_days = current.trip_days;

  // Intentionally lossy for this experiment: interests are unioned, not replaced.
  const mergedInterests = new Set<Interest>([...memory.interests, ...current.interests]);
  out.interests = [...mergedInterests];

  return out;
}

function scoreDoc(doc: (typeof SOURCE_SPECS)[number], prefs: Preferences): number {
  let score = 0;

  if (prefs.city && doc.city === prefs.city) score += 2;
  if (prefs.interests.length > 0 && prefs.interests.includes(doc.category)) score += 2;
  if (prefs.budget !== 'unknown') {
    if (prefs.budget === 'cheap' && doc.price_level === 'cheap') score += 2;
    if (prefs.budget === 'medium' && (doc.price_level === 'cheap' || doc.price_level === 'medium')) score += 1;
    if (prefs.budget === 'expensive') score += 1;
  }

  return score;
}

function retrieveDocs(prefs: Preferences): RetrievedDoc[] {
  const ranked = SOURCE_SPECS.map((doc) => ({
    url: doc.url,
    city: doc.city,
    category: doc.category,
    price_level: doc.price_level,
    text: doc.fallback_text,
    score: scoreDoc(doc, prefs),
  }))
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  return ranked;
}

function summarizeMemory(previous: MemorySummary, query: string, prefs: Preferences, answer: string): MemorySummary {
  const intent = answer.startsWith('Refused') ? 'safety-refusal' : 'travel-planning';
  const city = prefs.city ?? previous.city;
  const budget = prefs.budget === 'unknown' ? previous.budget : prefs.budget;

  // Intentionally keeps old interests when user says "only"; useful to expose memory failures.
  const interests = prefs.interests.length > 0 ? [...new Set([...previous.interests, ...prefs.interests])] : previous.interests;

  const short = [
    city ? `city=${city}` : 'city=none',
    `budget=${budget}`,
    `interests=${interests.length > 0 ? interests.join('|') : 'none'}`,
    `last_query=${query.slice(0, 50)}`,
  ].join('; ');

  return {
    text: short,
    city,
    interests,
    budget,
    lastUserIntent: intent,
  };
}

function shouldRefuse(query: string): boolean {
  return UNSAFE_PATTERNS.some((re) => re.test(query));
}

function buildAnswer(query: string, docs: RetrievedDoc[], prefs: Preferences): string {
  if (docs.length === 0) {
    return 'Insufficient grounded context for this request. Please specify city, budget, or interests.';
  }

  const lines = docs.slice(0, 3).map((d) => `- ${d.category} (${d.price_level}) from ${d.url}`);
  const prefLine = `Applied prefs: city=${prefs.city ?? 'none'}, budget=${prefs.budget}, interests=${prefs.interests.join(',') || 'none'}.`;
  return `${prefLine}\n${lines.join('\n')}`;
}

function detectMemoryMistake(query: string, prefs: Preferences, answer: string): { wrong: boolean; note: string } {
  const q = query.toLowerCase();

  if (q.includes('generic for europe') && prefs.city === 'berlin') {
    return {
      wrong: true,
      note: 'Memory kept city=berlin after user requested a generic Europe answer.',
    };
  }

  if (q.includes('street food only') && prefs.interests.includes('art')) {
    return {
      wrong: true,
      note: 'Memory union kept art along with food, so retrieval was not truly "only food".',
    };
  }

  if (answer.startsWith('Refused')) {
    return { wrong: false, note: '' };
  }

  return { wrong: false, note: '' };
}

function runTurn(query: string, memory: MemorySummary): TurnTrace {
  const steps: AgentStep[] = [];
  const memoryBefore = { ...memory, interests: [...memory.interests] };

  const parsed = parsePreferences(query);
  let resolved = mergePreferencesWithMemory(parsed, memory);
  let retrieved: RetrievedDoc[] = [];
  let finalDecision: AgentAction = 'refuse';
  let answer = 'Refused: request not supported.';
  let loop = 0;

  while (loop < 4) {
    loop += 1;

    if (shouldRefuse(query)) {
      steps.push({
        step: loop,
        action: 'refuse',
        reason: 'Unsafe intent detected.',
        executed: 'Safety gate blocked request.',
        continueLoop: false,
      });
      finalDecision = 'refuse';
      answer = 'Refused: unsafe request detected.';
      break;
    }

    if (loop === 1 && !resolved.city && resolved.interests.length === 0 && resolved.budget === 'unknown') {
      const toolPrefs = parsePreferences(query);
      resolved = mergePreferencesWithMemory(toolPrefs, memory);

      steps.push({
        step: loop,
        action: 'tool',
        reason: 'Query underspecified. Run parser tool first.',
        executed: `Extracted preferences: ${JSON.stringify(toolPrefs)}`,
        continueLoop: true,
      });
      continue;
    }

    if (retrieved.length === 0) {
      retrieved = retrieveDocs(resolved);
      steps.push({
        step: loop,
        action: 'retrieve',
        reason: 'Need grounded context before answering.',
        executed: `Retrieved ${retrieved.length} documents.`,
        continueLoop: true,
      });

      if (retrieved.length === 0) {
        continue;
      }

      continue;
    }

    if (retrieved.length > 0) {
      answer = buildAnswer(query, retrieved, resolved);
      steps.push({
        step: loop,
        action: 'answer',
        reason: 'Context is sufficient to answer with citations.',
        executed: 'Produced grounded answer.',
        continueLoop: false,
      });
      finalDecision = 'answer';
      break;
    }

    steps.push({
      step: loop,
      action: 'refuse',
      reason: 'No viable action left.',
      executed: 'Stopped loop.',
      continueLoop: false,
    });
    finalDecision = 'refuse';
    answer = 'Refused: not enough context to continue.';
    break;
  }

  if (finalDecision !== 'answer' && finalDecision !== 'refuse') {
    finalDecision = retrieved.length > 0 ? 'answer' : 'refuse';
    answer = finalDecision === 'answer' ? buildAnswer(query, retrieved, resolved) : 'Refused: unresolved request.';
  }

  const memoryAfter = summarizeMemory(memory, query, resolved, answer);
  const memoryCheck = detectMemoryMistake(query, resolved, answer);

  return {
    user_query: query,
    resolved_query: JSON.stringify(resolved),
    parsed_preferences: resolved,
    memory_before: memoryBefore,
    memory_after: memoryAfter,
    steps,
    retrieved_count: retrieved.length,
    final_decision: finalDecision,
    answer,
    memory_wrong: memoryCheck.wrong,
    memory_wrong_note: memoryCheck.note,
  };
}

function runConversation(s: ConversationScenario): ConversationRun {
  let memory = defaultMemory();
  const traces: TurnTrace[] = [];

  for (const turn of s.turns) {
    const trace = runTurn(turn.text, memory);
    memory = trace.memory_after;
    traces.push(trace);
  }

  return {
    id: s.id,
    title: s.title,
    expectation: s.expectation,
    traces,
    wrong_memory_turns: traces.filter((t) => t.memory_wrong).length,
  };
}

function buildFlowDiagramMermaid(): string {
  return [
    'flowchart TD',
    '  A[User turn] --> B[Decide next action]',
    '  B -->|unsafe| R[Refuse and stop]',
    '  B -->|underspecified| T[Tool: parse intent/preferences]',
    '  B -->|need grounding| K[Retrieve docs]',
    '  T --> B',
    '  K --> J{Enough context?}',
    '  J -->|yes| N[Answer with citations]',
    '  J -->|no| B',
    '  N --> M[Update short memory summary]',
    '  R --> M',
    '  M --> E[Next user turn or end]',
  ].join('\n');
}

function buildMarkdownReport(runs: ConversationRun[]): string {
  const totalWrong = runs.reduce((acc, r) => acc + r.wrong_memory_turns, 0);

  const lines: string[] = [];
  lines.push('# Day 12 - ReAct vs Plan-and-Execute (Practical Agent Pattern Comparison)');
  lines.push('');
  lines.push('## Agent Flow Diagram (Decision Loop)');
  lines.push('');
  lines.push('```mermaid');
  lines.push(buildFlowDiagramMermaid());
  lines.push('```');
  lines.push('');
  lines.push('## Multi-turn Evaluation (5 Examples)');
  lines.push('');

  for (const run of runs) {
    lines.push(`### ${run.id.toUpperCase()} - ${run.title}`);
    lines.push(`Expected behavior: ${run.expectation}`);
    lines.push('');

    run.traces.forEach((t, idx) => {
      lines.push(`Turn ${idx + 1} user query: "${t.user_query}"`);
      lines.push(`- Final decision: ${t.final_decision}`);
      lines.push(`- Retrieved count: ${t.retrieved_count}`);
      lines.push(`- Step actions: ${t.steps.map((s) => s.action).join(' -> ')}`);
      lines.push(`- Memory before: ${t.memory_before.text}`);
      lines.push(`- Memory after: ${t.memory_after.text}`);
      if (t.memory_wrong) {
        lines.push(`- Memory-caused wrong decision: YES (${t.memory_wrong_note})`);
      } else {
        lines.push('- Memory-caused wrong decision: NO');
      }
      lines.push(`- Answer (short): ${t.answer.split('\n')[0]}`);
      lines.push('');
    });
  }

  lines.push('## Pattern Note');
  lines.push('');
  lines.push('Implemented pattern: ReAct-style decision loop with explicit action gating.');
  lines.push('');
  lines.push('Why this pattern:');
  lines.push('- The loop repeatedly decides an action (`retrieve` / `tool` / `answer` / `refuse`) and executes it until stop criteria are met.');
  lines.push('- It keeps control flow transparent in traces, making it easy to diagnose failures.');
  lines.push('- A lightweight memory summary supports multi-turn continuity, while exposing known failure modes.');
  lines.push('');
  lines.push(`Observed memory-caused errors: ${totalWrong} turns across 5 examples (minimum required: 2).`);

  return lines.join('\n');
}

async function main(): Promise<void> {
  await fs.mkdir(DAY12_DOCS_DIR, { recursive: true });

  const runs = SCENARIOS.map(runConversation);

  const resultPayload = {
    generated_at: new Date().toISOString(),
    pattern: 'react-style-decision-loop',
    scenarios: runs,
  };

  await fs.writeFile(RESULTS_PATH, JSON.stringify(resultPayload, null, 2), 'utf8');

  const diagram = buildFlowDiagramMermaid();
  await fs.writeFile(FLOW_PATH, diagram, 'utf8');

  const report = buildMarkdownReport(runs);
  await fs.writeFile(REPORT_PATH, report, 'utf8');

  console.log(`Wrote: ${RESULTS_PATH}`);
  console.log(`Wrote: ${FLOW_PATH}`);
  console.log(`Wrote: ${REPORT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
