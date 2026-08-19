#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { extract } from './pipeline.ts';
import { extractAsync } from './llm/fallback.ts';
import type { Email, ExtractionResult } from './types.ts';

interface FixtureCase extends Email { id?: string; expected?: unknown; category_to_build?: string }
interface FixtureFile { today?: string; cases?: FixtureCase[] }

interface Args {
  files: string[];
  today: string | null;
  out: string;
  llm: boolean;
  quiet: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { files: [], today: null, out: 'out', llm: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--today') args.today = argv[++i] ?? null;
    else if (a === '--out') args.out = argv[++i] ?? 'out';
    else if (a === '--llm') args.llm = true;
    else if (a === '--quiet') args.quiet = true;
    else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
    else if (a && !a.startsWith('-')) args.files.push(a);
  }
  return args;
}

function usage(): void {
  console.log(`inbox-extract — structured extraction from transactional email

  node --experimental-strip-types src/cli.ts <fixtures.json...> [options]

Options
  --today YYYY-MM-DD   Reference date for bill status. Falls back to the fixture's
                       own "today", then to the system date (with a warning).
  --out DIR            Output directory (default: out)
  --llm                Enable the unknown-sender fallback (needs ANTHROPIC_API_KEY)
  --quiet              Suppress the summary table
`);
}

/** Only the five keys the brief specifies, for a clean side-by-side artifact. */
function slim(r: ExtractionResult) {
  return {
    category: r.category,
    schemaType: r.schemaType,
    data: r.data,
    confidence: r.confidence,
    missing: r.missing,
  };
}

const PAD = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.files.length === 0) { usage(); process.exit(1); }

  mkdirSync(args.out, { recursive: true });
  const combined: unknown[] = [];

  for (const file of args.files) {
    const fixture = JSON.parse(readFileSync(file, 'utf8')) as FixtureFile;
    const cases = fixture.cases ?? [];

    let today = args.today ?? fixture.today ?? null;
    if (!today) {
      today = new Date().toISOString().slice(0, 10);
      console.warn(`! ${basename(file)}: no reference date supplied; using system date ${today}. Pass --today for reproducible status values.`);
    }

    const rows: Array<{ id: string; from?: string; subject?: string; result: ExtractionResult }> = [];
    for (const c of cases) {
      const email: Email = { id: c.id, from: c.from, subject: c.subject, body: c.body, date: c.date };
      const result = args.llm
        ? await extractAsync(email, { today, llm: true })
        : extract(email, { today });
      rows.push({ id: c.id ?? '(no id)', from: c.from, subject: c.subject, result });
    }

    const name = basename(file).replace(/\.json$/, '').replace(/^fixtures\./, '');
    const payload = { source: basename(file), today, generatedWith: 'rules', cases: rows };
    writeFileSync(join(args.out, `output.${name}.json`), `${JSON.stringify(payload, null, 2)}\n`);
    writeFileSync(
      join(args.out, `output.${name}.slim.json`),
      `${JSON.stringify({ source: basename(file), today, cases: rows.map((r) => ({ id: r.id, ...slim(r.result) })) }, null, 2)}\n`,
    );
    combined.push(...rows.map((r) => ({ source: basename(file), ...r })));

    if (!args.quiet) {
      console.log(`\n${basename(file)}  (today = ${today})`);
      console.log(`  ${PAD('id', 22)}${PAD('category', 14)}${PAD('conf', 8)}${PAD('schemaType', 26)}missing / partial`);
      console.log(`  ${'-'.repeat(96)}`);
      for (const r of rows) {
        const res = r.result;
        const flags = [
          res.missing.length ? `missing: ${res.missing.join(',')}` : '',
          res.partial?.length ? `partial: ${res.partial.join(',')}` : '',
        ].filter(Boolean).join('  ') || '—';
        console.log(`  ${PAD(r.id, 22)}${PAD(res.category, 14)}${PAD(res.confidence, 8)}${PAD(res.schemaType ?? '—', 26)}${flags}`);
      }
    }
  }

  writeFileSync(join(args.out, 'output.all.json'), `${JSON.stringify(combined, null, 2)}\n`);
  if (!args.quiet) console.log(`\nWrote ${args.files.length * 2 + 1} file(s) to ${args.out}/`);
}

main().catch((err) => { console.error(err); process.exit(1); });
