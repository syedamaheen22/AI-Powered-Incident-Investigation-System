import fs from 'node:fs/promises';
import path from 'node:path';

interface Entity {
  id: string;
  type: 'City' | 'Place' | 'Cuisine';
  name: string;
  props?: Record<string, string>;
}

interface Relation {
  from: string;
  type: 'HAS_PLACE' | 'HAS_CUISINE' | 'SUITS_BUDGET' | 'HAS_TAG';
  to: string;
}

interface KgQuery {
  city: string;
  tag: string;
  budget: 'cheap' | 'medium' | 'expensive';
}

interface QueryResult {
  query: KgQuery;
  matched_places: string[];
  matched_cuisines: string[];
  reasoning_trace: string[];
}

interface RunOutput {
  generated_at: string;
  hands_on_example: string;
  entities_loaded: number;
  relations_loaded: number;
  sample_triples: Array<[string, string, string]>;
  query_results: QueryResult[];
  minimal_agent_flow: {
    question: string;
    parsed_query: KgQuery;
    response: string;
  };
}

const DOCS_DIR = path.join(process.cwd(), 'docs/day13');
const RESULTS_PATH = path.join(DOCS_DIR, 'day13-kg-hands-on-results.json');

function buildDataset(): { entities: Entity[]; relations: Relation[] } {
  const entities: Entity[] = [
    { id: 'city_berlin', type: 'City', name: 'Berlin' },
    { id: 'place_museum_island', type: 'Place', name: 'Museum Island', props: { tag: 'art' } },
    { id: 'place_east_side_gallery', type: 'Place', name: 'East Side Gallery', props: { tag: 'art' } },
    { id: 'place_tempelhofer_feld', type: 'Place', name: 'Tempelhofer Feld', props: { tag: 'outdoors' } },
    { id: 'cuisine_street_food', type: 'Cuisine', name: 'Street Food Markets' },
  ];

  const relations: Relation[] = [
    { from: 'city_berlin', type: 'HAS_PLACE', to: 'place_museum_island' },
    { from: 'city_berlin', type: 'HAS_PLACE', to: 'place_east_side_gallery' },
    { from: 'city_berlin', type: 'HAS_PLACE', to: 'place_tempelhofer_feld' },
    { from: 'city_berlin', type: 'HAS_CUISINE', to: 'cuisine_street_food' },
    { from: 'place_museum_island', type: 'SUITS_BUDGET', to: 'medium' },
    { from: 'place_east_side_gallery', type: 'SUITS_BUDGET', to: 'cheap' },
    { from: 'place_tempelhofer_feld', type: 'SUITS_BUDGET', to: 'cheap' },
    { from: 'cuisine_street_food', type: 'SUITS_BUDGET', to: 'cheap' },
    { from: 'place_museum_island', type: 'HAS_TAG', to: 'art' },
    { from: 'place_east_side_gallery', type: 'HAS_TAG', to: 'art' },
    { from: 'place_tempelhofer_feld', type: 'HAS_TAG', to: 'outdoors' },
  ];

  return { entities, relations };
}

function getEntityById(entities: Entity[], id: string): Entity | undefined {
  return entities.find((e) => e.id === id);
}

function queryGraph(entities: Entity[], relations: Relation[], query: KgQuery): QueryResult {
  const cityId = `city_${query.city.toLowerCase()}`;
  const trace: string[] = [];

  const placeIds = relations
    .filter((r) => r.from === cityId && r.type === 'HAS_PLACE')
    .map((r) => r.to);
  trace.push(`Found ${placeIds.length} places connected to ${query.city}.`);

  const filteredPlaces = placeIds.filter((placeId) => {
    const hasTag = relations.some((r) => r.from === placeId && r.type === 'HAS_TAG' && r.to === query.tag);
    const fitsBudget = relations.some((r) => r.from === placeId && r.type === 'SUITS_BUDGET' && r.to === query.budget);
    return hasTag && fitsBudget;
  });
  trace.push(`After tag+budget filters, ${filteredPlaces.length} places remain.`);

  const cuisineIds = relations
    .filter((r) => r.from === cityId && r.type === 'HAS_CUISINE')
    .map((r) => r.to)
    .filter((cuisineId) => relations.some((r) => r.from === cuisineId && r.type === 'SUITS_BUDGET' && r.to === query.budget));
  trace.push(`Found ${cuisineIds.length} cuisine options for budget=${query.budget}.`);

  return {
    query,
    matched_places: filteredPlaces.map((id) => getEntityById(entities, id)?.name ?? id),
    matched_cuisines: cuisineIds.map((id) => getEntityById(entities, id)?.name ?? id),
    reasoning_trace: trace,
  };
}

function parseQuestionToQuery(question: string): KgQuery {
  const q = question.toLowerCase();
  return {
    city: q.includes('berlin') ? 'berlin' : 'berlin',
    tag: q.includes('art') ? 'art' : 'outdoors',
    budget: q.includes('cheap') || q.includes('budget') ? 'cheap' : 'medium',
  };
}

function buildAgentResponse(result: QueryResult): string {
  if (result.matched_places.length === 0 && result.matched_cuisines.length === 0) {
    return 'I could not find a matching grounded path in the KG for that request.';
  }

  return [
    `Grounded by KG lookup for ${result.query.city} (${result.query.tag}, ${result.query.budget}).`,
    `Places: ${result.matched_places.join(', ') || 'none'}.`,
    `Cuisine: ${result.matched_cuisines.join(', ') || 'none'}.`,
  ].join(' ');
}

async function main(): Promise<void> {
  const { entities, relations } = buildDataset();

  const sampleQueries: KgQuery[] = [
    { city: 'berlin', tag: 'art', budget: 'cheap' },
    { city: 'berlin', tag: 'outdoors', budget: 'cheap' },
  ];

  const queryResults = sampleQueries.map((q) => queryGraph(entities, relations, q));

  const question = 'Find cheap art-focused options in Berlin and include food ideas.';
  const parsedQuery = parseQuestionToQuery(question);
  const routedResult = queryGraph(entities, relations, parsedQuery);
  const response = buildAgentResponse(routedResult);

  const output: RunOutput = {
    generated_at: new Date().toISOString(),
    hands_on_example: 'Minimal KG lookup integrated into an agent-style route->lookup->respond flow',
    entities_loaded: entities.length,
    relations_loaded: relations.length,
    sample_triples: [
      ['Berlin', 'HAS_PLACE', 'East Side Gallery'],
      ['East Side Gallery', 'SUITS_BUDGET', 'cheap'],
      ['East Side Gallery', 'HAS_TAG', 'art'],
    ],
    query_results: queryResults,
    minimal_agent_flow: {
      question,
      parsed_query: parsedQuery,
      response,
    },
  };

  await fs.mkdir(DOCS_DIR, { recursive: true });
  await fs.writeFile(RESULTS_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  console.log(`Wrote KG hands-on results to ${RESULTS_PATH}`);
}

main().catch((error) => {
  console.error('Failed to run KG hands-on comparison:', error);
  process.exitCode = 1;
});
