#!/usr/bin/env node
/**
 * Scores the extractor against data/gold.json.
 *
 * Two of these numbers matter more than the rest:
 *   - abstention: did the marketing blasts come back 'none'
 *   - hallucination: did any emitted field fail to appear verbatim in its email
 * The hallucination check re-reads the raw fixture strings rather than the
 * extractor's own normalised text, so it does not grade itself.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { extract } from '../src/index.ts';
import type { Email, ExtractionResult, Provenance } from '../src/types.ts';

interface FixtureCase extends Email { id?: string }
interface FixtureFile { today?: string; cases?: FixtureCase[] }
interface GoldEntry {
  category: string;
  schemaType: string | null;
  confidence?: string;
  missing?: string[];
  partial?: string[];
  data: Record<string, unknown> | null;
}

const FIXTURES: Array<[key: string, path: string]> = [
  ['bills', 'data/fixtures.bills.json'],
  ['commerce', 'data/fixtures.commerce.json'],
  ['travel', 'data/fixtures.travel.json'],
];

const gold = JSON.parse(readFileSync('data/gold.json', 'utf8')) as { today: string; cases: Record<string, GoldEntry> };

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (typeof a !== 'object') return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

interface CaseReport {
  key: string;
  categoryOk: boolean;
  schemaOk: boolean;
  goldFields: number;
  matched: number;
  wrong: Array<{ field: string; expected: unknown; got: unknown }>;
  absent: string[];
  extra: string[];
  ungrounded: Array<{ field: string; quote: string }>;
}

const reports: CaseReport[] = [];

for (const [prefix, path] of FIXTURES) {
  const fixture = JSON.parse(readFileSync(path, 'utf8')) as FixtureFile;
  for (const c of fixture.cases ?? []) {
    const key = `${prefix}:${c.id}`;
    const expected = gold.cases[key];
    if (!expected) continue;

    const result: ExtractionResult = extract(
      { id: c.id, from: c.from, subject: c.subject, body: c.body },
      { today: gold.today },
    );

    // Independent grounding audit against the untouched fixture strings.
    const raw = squash(`${c.from ?? ''}\n${c.subject ?? ''}\n${c.body ?? ''}`);
    const ungrounded: CaseReport['ungrounded'] = [];
    for (const [field, p] of Object.entries((result.provenance ?? {}) as Record<string, Provenance>)) {
      if (p.source === 'jsonld' || p.source === 'microdata') continue;
      if (!raw.includes(squash(p.quote))) ungrounded.push({ field, quote: p.quote });
    }

    const goldData = expected.data ?? {};
    const gotData = (result.data ?? {}) as Record<string, unknown>;
    const wrong: CaseReport['wrong'] = [];
    const absent: string[] = [];
    let matched = 0;

    for (const [field, want] of Object.entries(goldData)) {
      if (!Object.hasOwn(gotData, field)) { absent.push(field); continue; }
      if (deepEqual(want, gotData[field])) matched += 1;
      else wrong.push({ field, expected: want, got: gotData[field] });
    }

    reports.push({
      key,
      categoryOk: result.category === expected.category,
      schemaOk: result.schemaType === expected.schemaType,
      goldFields: Object.keys(goldData).length,
      matched,
      wrong,
      absent,
      extra: Object.keys(gotData).filter((k) => !Object.hasOwn(goldData, k)),
      ungrounded,
    });
  }
}

const total = reports.length;
const categoryOk = reports.filter((r) => r.categoryOk).length;
const schemaOk = reports.filter((r) => r.schemaOk).length;
const goldFields = reports.reduce((n, r) => n + r.goldFields, 0);
const matched = reports.reduce((n, r) => n + r.matched, 0);
const wrong = reports.reduce((n, r) => n + r.wrong.length, 0);
const absent = reports.reduce((n, r) => n + r.absent.length, 0);
const extra = reports.reduce((n, r) => n + r.extra.length, 0);
const ungrounded = reports.reduce((n, r) => n + r.ungrounded.length, 0);
const perfect = reports.filter((r) => r.matched === r.goldFields && r.wrong.length === 0 && r.absent.length === 0).length;

const decoys = reports.filter((r) => r.key.endsWith('promo-decoy'));
const decoysRejected = decoys.filter((r) => r.categoryOk).length;
const transactional = reports.filter((r) => !r.key.endsWith('promo-decoy'));

const pct = (n: number, d: number) => (d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`);

const metrics = {
  cases: total,
  categoryAccuracy: pct(categoryOk, total),
  schemaTypeAccuracy: pct(schemaOk, total),
  fieldRecall: pct(matched, goldFields),
  fieldPrecision: pct(matched, matched + wrong),
  perfectCards: pct(perfect, total),
  promoRejection: `${pct(decoysRejected, decoys.length)} (${decoysRejected}/${decoys.length})`,
  falsePositiveExtractions: decoys.length - decoysRejected,
  hallucinatedFields: ungrounded,
  additionalFieldsBeyondGold: extra,
  transactionalCases: transactional.length,
};

console.log('\ninbox-extract — evaluation vs data/gold.json\n');
for (const [k, v] of Object.entries(metrics)) {
  console.log(`  ${k.padEnd(28)} ${String(v)}`);
}

const problems = reports.filter((r) => !r.categoryOk || !r.schemaOk || r.wrong.length || r.absent.length || r.ungrounded.length);
if (problems.length) {
  console.log('\n  Problems');
  for (const r of problems) {
    console.log(`  · ${r.key}`);
    if (!r.categoryOk) console.log('      category mismatch');
    if (!r.schemaOk) console.log('      schemaType mismatch');
    for (const w of r.wrong) console.log(`      ${w.field}: expected ${JSON.stringify(w.expected)} got ${JSON.stringify(w.got)}`);
    for (const a of r.absent) console.log(`      ${a}: absent from output`);
    for (const u of r.ungrounded) console.log(`      ${u.field}: quote not found in source (${JSON.stringify(u.quote)})`);
  }
} else {
  console.log('\n  No mismatches.');
}

console.log(`\n  Fields beyond gold (emitted, grounded, not scored): ${extra}`);
for (const r of reports.filter((x) => x.extra.length)) {
  console.log(`      ${r.key}: ${r.extra.join(', ')}`);
}
console.log();

mkdirSync('eval/out', { recursive: true });
writeFileSync('eval/out/report.json', `${JSON.stringify({ metrics, reports }, null, 2)}\n`);

// Non-zero exit makes this usable as a gate: a hallucinated field or a
// misfiled promo should fail a build, not just print.
const failed = categoryOk !== total || ungrounded > 0;
process.exit(failed ? 1 : 0);
