// # Assignment Goal
// Pick 30 strings (code, Urdu/Deutsch mix, emojis, long URLs, JSON), tokenize them
// using 2 different tokenizers/models, and compare token counts.
//
// # How This Script Solves It
// 1. Defines exactly 30 samples across the required categories.
// 2. Tokenizes each sample with:
//    - Model A: gpt-4o tokenizer via @dqbd/tiktoken
//    - Model B: gpt-2 tokenizer via gpt-3-encoder
// 3. Computes token counts, diff, and ratio for each string.
// 4. Generates outputs in docs/day1/:
//    - TOKENIZER_COMPARISON.md (table + 5 surprises explained)
//    - tokenizer-comparison.json (raw numeric results)

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { encoding_for_model } from '@dqbd/tiktoken';
import { encode as encodeGpt2 } from 'gpt-3-encoder';

interface Sample {
  id: string;
  category: string;
  text: string;
}

interface CountRow {
  id: string;
  category: string;
  text: string;
  modelA: number;
  modelB: number;
  diff: number;
  ratio: number;
}

const MODEL_A_NAME = 'gpt-4o tokenizer (tiktoken)';
const MODEL_B_NAME = 'gpt-2 tokenizer (gpt-3-encoder)';

const SAMPLES: Sample[] = [
  { id: 's01', category: 'code', text: 'const sum = (a, b) => a + b;' },
  { id: 's02', category: 'code', text: 'for (let i = 0; i < arr.length; i++) total += arr[i];' },
  { id: 's03', category: 'code', text: 'SELECT city, SUM(amount) FROM orders GROUP BY city ORDER BY SUM(amount) DESC LIMIT 3;' },
  { id: 's04', category: 'code', text: 'if (user?.profile?.name) console.log(user.profile.name);' },
  { id: 's05', category: 'code', text: '{"status":"ok","data":[1,2,3],"meta":{"cached":false}}' },

  { id: 's06', category: 'urdu+deutsch', text: 'Mujhe kal Berlin jana hai, aber ticket bohat mehnga hai.' },
  { id: 's07', category: 'urdu+deutsch', text: 'Yeh feature sahi lagta hai, doch performance thori slow hai.' },
  { id: 's08', category: 'urdu+deutsch', text: 'Bitte jaldi karo, client ka demo 5 minute mein hai.' },
  { id: 's09', category: 'urdu+deutsch', text: 'Das system theek hai lekin logs bilkul clear nahi hain.' },
  { id: 's10', category: 'urdu+deutsch', text: 'Aaj ka weather acha hai, trotzdem sunscreen mat bhoolna.' },

  { id: 's11', category: 'emoji', text: 'I passed the exam! 🎉✅📚' },
  { id: 's12', category: 'emoji', text: 'Deploy failed 😭🔥 retrying now...' },
  { id: 's13', category: 'emoji', text: 'Weekend mood: 😴🍕🎬' },
  { id: 's14', category: 'emoji', text: 'Ship it 🚀🚀🚀 then monitor 👀' },
  { id: 's15', category: 'emoji', text: 'Family group be like 😂😂😂😂😂' },

  {
    id: 's16',
    category: 'long-url',
    text: 'https://example.com/products/smart-sunscreen?city=karachi&weather=humid&uv_index=11&session_id=abc123xyz987&utm_source=newsletter&utm_medium=email&utm_campaign=spring_launch',
  },
  {
    id: 's17',
    category: 'long-url',
    text: 'https://docs.company.io/v1/api/reference/users/list?page=14&page_size=50&sort=last_login_desc&include=profile%2Cpermissions%2Cdevices',
  },
  {
    id: 's18',
    category: 'long-url',
    text: 'https://maps.example.org/route?from=31.5204,74.3587&to=33.6844,73.0479&mode=driving&avoid=tolls%2Chighways&lang=ur',
  },
  {
    id: 's19',
    category: 'long-url',
    text: 'https://cdn.site.net/assets/images/2026/03/12/high-resolution-super-long-file-name-with-many-segments-final-final-v2.png',
  },
  {
    id: 's20',
    category: 'long-url',
    text: 'https://auth.example.dev/oauth/authorize?client_id=mobile-app-22&redirect_uri=https%3A%2F%2Fapp.example.dev%2Fcallback&response_type=code&scope=openid%20profile%20email',
  },

  { id: 's21', category: 'json', text: '{"event":"checkout","user":{"id":991,"tier":"gold"},"cart":[{"sku":"A1","qty":2},{"sku":"B9","qty":1}]}' },
  { id: 's22', category: 'json', text: '{"city":"Lahore","forecast":[{"day":"Mon","temp":32},{"day":"Tue","temp":34}],"advice":"hydrate"}' },
  { id: 's23', category: 'json', text: '{"error":{"code":"RATE_LIMIT","retry_after_ms":1200},"request_id":"req_89x7"}' },
  { id: 's24', category: 'json', text: '{"query":"top cities","sql":"SELECT city, SUM(amount) total FROM orders GROUP BY city"}' },
  { id: 's25', category: 'json', text: '{"a":[1,2,3,4,5,6,7,8,9,10],"b":true,"c":null,"d":"x"}' },

  { id: 's26', category: 'mixed', text: 'Password reset OTP is 583921. Do not share it with anyone.' },
  { id: 's27', category: 'mixed', text: 'Line1\nLine2\nLine3 with tabs\tand spaces.' },
  { id: 's28', category: 'mixed', text: 'C:\\Users\\maheen\\Documents\\GenAi\\reports\\final_v3.pdf' },
  { id: 's29', category: 'mixed', text: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
  { id: 's30', category: 'mixed', text: 'The quick brown fox jumps over 13 lazy dogs near Zürich at 7:45pm.' },
];

function escapeMd(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, '\\n');
}

function tokenCountModelA(encoder: ReturnType<typeof encoding_for_model>, text: string): number {
  return encoder.encode(text).length;
}

function tokenCountModelB(text: string): number {
  return encodeGpt2(text).length;
}

function buildRows(): CountRow[] {
  const encoder = encoding_for_model('gpt-4o');
  try {
    return SAMPLES.map((sample) => {
      const modelA = tokenCountModelA(encoder, sample.text);
      const modelB = tokenCountModelB(sample.text);
      const diff = modelA - modelB;
      const ratio = modelB === 0 ? 0 : Number((modelA / modelB).toFixed(3));

      return {
        id: sample.id,
        category: sample.category,
        text: sample.text,
        modelA,
        modelB,
        diff,
        ratio,
      };
    });
  } finally {
    encoder.free();
  }
}

function pickSurprises(rows: CountRow[]): CountRow[] {
  const byAbsDiff = [...rows].sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  const picked: CountRow[] = [];

  for (const row of byAbsDiff) {
    if (picked.length >= 5) {
      break;
    }

    if (!picked.some((existing) => existing.category === row.category)) {
      picked.push(row);
    }
  }

  for (const row of byAbsDiff) {
    if (picked.length >= 5) {
      break;
    }

    if (!picked.some((existing) => existing.id === row.id)) {
      picked.push(row);
    }
  }

  return picked;
}

function explainSurprise(row: CountRow): string {
  if (row.category === 'emoji') {
    return 'Emoji and multi-byte symbols are segmented differently by BPE vocabularies, often creating larger gaps.';
  }

  if (row.category === 'long-url') {
    return 'Long URLs contain many separators and uncommon fragments, so merge rules differ heavily between tokenizers.';
  }

  if (row.category === 'urdu+deutsch') {
    return 'Mixed-language transliteration has less frequent token merges, so token splits vary across model vocabularies.';
  }

  if (row.category === 'json') {
    return 'Structured symbols like braces, quotes, and repeated key patterns may compress better in one tokenizer than another.';
  }

  if (row.category === 'code') {
    return 'Code syntax has predictable punctuation patterns; each tokenizer may chunk operators and identifiers differently.';
  }

  return 'This string combines uncommon patterns where each tokenizer applies different merge boundaries.';
}

function buildMarkdown(rows: CountRow[]): string {
  const surprises = pickSurprises(rows);
  const avgA = Number((rows.reduce((sum, row) => sum + row.modelA, 0) / rows.length).toFixed(2));
  const avgB = Number((rows.reduce((sum, row) => sum + row.modelB, 0) / rows.length).toFixed(2));

  const lines: string[] = [];
  lines.push('# Tokenizer Comparison (30 Strings)');
  lines.push('');
  lines.push(`- Model A: ${MODEL_A_NAME}`);
  lines.push(`- Model B: ${MODEL_B_NAME}`);
  lines.push(`- Strings compared: ${rows.length}`);
  lines.push(`- Average tokens: Model A = ${avgA}, Model B = ${avgB}`);
  lines.push('');

  lines.push('## Table: string -> token_count_modelA vs modelB');
  lines.push('');
  lines.push('| ID | Category | String | token_count_modelA | token_count_modelB | Diff (A-B) | Ratio (A/B) |');
  lines.push('|---|---|---|---:|---:|---:|---:|');

  for (const row of rows) {
    lines.push(
      `| ${row.id} | ${row.category} | ${escapeMd(row.text)} | ${row.modelA} | ${row.modelB} | ${row.diff} | ${row.ratio} |`,
    );
  }

  lines.push('');
  lines.push('## 5 Surprises Explained');
  lines.push('');

  for (const [index, row] of surprises.entries()) {
    lines.push(`${index + 1}. ${row.id} (${row.category}) -> A=${row.modelA}, B=${row.modelB}, diff=${row.diff}`);
    lines.push(`Reason: ${explainSurprise(row)}`);
  }

  lines.push('');
  lines.push('## Raw Notes');
  lines.push('');
  lines.push('- Positive diff means Model A used more tokens.');
  lines.push('- Negative diff means Model B used more tokens.');
  lines.push('- Ratios near 1 indicate similar segmentation behavior.');

  return lines.join('\n');
}

function main(): void {
  const rows = buildRows();
  const markdown = buildMarkdown(rows);

  const docsDir = resolve(process.cwd(), 'docs', 'day1');
  mkdirSync(docsDir, { recursive: true });

  const markdownPath = resolve(docsDir, 'TOKENIZER_COMPARISON.md');
  const jsonPath = resolve(docsDir, 'tokenizer-comparison.json');

  writeFileSync(markdownPath, markdown, 'utf-8');
  writeFileSync(jsonPath, JSON.stringify(rows, null, 2), 'utf-8');

  console.log('Tokenizer comparison completed. Files generated:');
  console.log(`- ${markdownPath}`);
  console.log(`- ${jsonPath}`);
}

main();
