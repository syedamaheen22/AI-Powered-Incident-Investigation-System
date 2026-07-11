'use strict';
const fs = require('fs');
const path = require('path');

const jpm = fs.readFileSync(path.join(__dirname, '../../data/pdfs/JPM-full.txt'), 'utf8');
const jnj = fs.readFileSync(path.join(__dirname, '../../data/pdfs/JNJ-full.txt'), 'utf8');

function find(text, pattern, label) {
  const idx = text.toLowerCase().indexOf(pattern.toLowerCase());
  if (idx === -1) {
    console.log(label, '"' + pattern + '" NOT FOUND');
    return null;
  }
  const snippet = text.slice(Math.max(0, idx - 100), idx + 300).replace(/\n/g, ' ');
  console.log(`--- ${label} | "${pattern}" at char ${idx} ---`);
  console.log(snippet);
  console.log('');
  return snippet;
}

console.log('===== JPM =====');
const jpmTerms = [
  'total net revenue',
  'net income',
  'return on common equity',
  'return on tangible common equity',
  'common equity Tier 1',
  'total assets',
  'deposits',
  'employees',
  'dividends declared per share',
  'book value per share',
  'provision for credit losses',
  'closing share price',
  'investment banking',
  'consumer banking',
  'commercial banking',
];
for (const t of jpmTerms) find(jpm, t, 'JPM');

console.log('===== JNJ =====');
const jnjTerms = [
  'net sales',
  'diluted earnings per share',
  'dividends per common share',
  'research and development',
  'operating income',
  'return on equity',
  'total debt',
  'employees',
  'medtech',
  'pharmaceutical',
  'innovative medicine',
  'adjusted earnings per share',
  'free cash flow',
  'acquisitions',
  'supply chain',
];
for (const t of jnjTerms) find(jnj, t, 'JNJ');
