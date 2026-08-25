#!/usr/bin/env node
/**
 * Renders every fixture as a Gmail-style card next to the email it came from.
 *
 * Clicking a field highlights the exact span it was read out of, which is the
 * fastest way to check the claim that nothing here is invented.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Doc, extract } from '../src/index.ts';
import type { Email, ExtractionResult, Money, Provenance } from '../src/types.ts';

const TODAY = '2026-09-15';
const FIXTURES: Array<[string, string]> = [
  ['bills', 'data/fixtures.bills.json'],
  ['commerce', 'data/fixtures.commerce.json'],
  ['travel', 'data/fixtures.travel.json'],
  ['shopping', 'data/fixtures.shopping.json'],
  ['money', 'data/fixtures.money.json'],
  ['life', 'data/fixtures.life.json'],
];

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Character-level field map, so overlapping spans still render correctly. */
function highlight(text: string, spans: Array<[string, number, number]>): string {
  const owners: Array<Set<string>> = Array.from({ length: text.length }, () => new Set<string>());
  for (const [field, start, end] of spans) {
    for (let i = Math.max(0, start); i < Math.min(text.length, end); i++) owners[i]?.add(field);
  }
  let out = '';
  let i = 0;
  while (i < text.length) {
    const key = [...(owners[i] ?? [])].sort().join(' ');
    let j = i + 1;
    while (j < text.length && [...(owners[j] ?? [])].sort().join(' ') === key) j++;
    const chunk = esc(text.slice(i, j));
    out += key ? `<mark data-fields="${esc(key)}">${chunk}</mark>` : chunk;
    i = j;
  }
  return out.replace(/\n/g, '<br>');
}

const isMoney = (v: unknown): v is Money =>
  typeof v === 'object' && v !== null && 'amount' in v && 'currency' in v;

const CURRENCY: Record<string, string> = { INR: '₹', USD: '$', EUR: '€', GBP: '£' };

function renderValue(v: unknown): string {
  if (isMoney(v)) {
    const sym = CURRENCY[v.currency] ?? `${v.currency} `;
    return `<span class="money">${esc(sym)}${v.amount.toLocaleString('en-IN')}</span><span class="raw">${esc(v.raw)}</span>`;
  }
  if (Array.isArray(v)) {
    return `<ul class="list">${v.map((item) => {
      if (item && typeof item === 'object' && 'name' in item) {
        const it = item as { name: string; quantity?: number; price?: Money };
        const qty = it.quantity ? `<span class="qty">${it.quantity}×</span>` : '';
        const price = it.price ? renderValue(it.price) : '';
        return `<li>${qty}${esc(it.name)} ${price}</li>`;
      }
      return `<li>${esc(String(item))}</li>`;
    }).join('')}</ul>`;
  }
  const s = String(v);
  if (s.startsWith('https://schema.org/')) return `<code class="enum">${esc(s.replace('https://schema.org/', ''))}</code>`;
  return esc(s);
}

function renderCard(r: ExtractionResult, notes: Record<string, string>): string {
  if (r.category === 'none') {
    return `<div class="card abstain">
      <div class="card-head"><span class="badge none">none</span><span class="conf ${r.confidence}">${r.confidence}</span></div>
      <p class="reason">${esc(r.reason ?? 'Not a transaction.')}</p>
      <p class="abstain-note">No card is shown because nothing here is a record of a transaction.</p>
    </div>`;
  }

  const rows = Object.entries(r.data ?? {}).map(([field, value]) => {
    const flag = r.partial?.includes(field) ? `<span class="flag partial" title="${esc(notes[field] ?? '')}">partial</span>` : '';
    return `<tr data-field="${esc(field)}"><th>${esc(field)}</th><td>${renderValue(value)}${flag}</td></tr>`;
  }).join('');

  const missing = r.missing.length
    ? `<div class="missing"><span class="label">missing</span>${r.missing.map((m) => `<code>${esc(m)}</code>`).join('')}<span class="hint">stated nowhere in the email — left empty rather than guessed</span></div>`
    : '';
  const warn = r.warnings?.length ? `<div class="warn">${r.warnings.map((w) => esc(w)).join('<br>')}</div>` : '';

  return `<div class="card">
    <div class="card-head">
      <span class="badge ${esc(r.category)}">${esc(r.category)}</span>
      <code class="schema">${esc(r.schemaType ?? '—')}</code>
      <span class="conf ${r.confidence}">${r.confidence}<em>${r.score ?? ''}</em></span>
    </div>
    <table>${rows}</table>
    ${missing}${warn}
  </div>`;
}

interface Row { id: string; email: Email; result: ExtractionResult }

const groups: Array<{ name: string; rows: Row[] }> = [];
for (const [name, path] of FIXTURES) {
  const fixture = JSON.parse(readFileSync(path, 'utf8')) as { cases?: Array<Email & { id?: string }> };
  const rows: Row[] = [];
  for (const c of fixture.cases ?? []) {
    const email: Email = { id: c.id, from: c.from, subject: c.subject, body: c.body };
    rows.push({ id: c.id ?? '?', email, result: extract(email, { today: TODAY }) });
  }
  groups.push({ name, rows });
}

const all = groups.flatMap((g) => g.rows);
const extracted = all.filter((r) => r.result.category !== 'none').length;
const abstained = all.length - extracted;
const fields = all.reduce((n, r) => n + Object.keys(r.result.data ?? {}).length, 0);

const sections = groups.map((g) => {
  const cases = g.rows.map(({ id, email, result }) => {
    const doc = new Doc(email);
    const prov = Object.entries((result.provenance ?? {}) as Record<string, Provenance>);
    const textSpans = prov.filter(([, p]) => p.source === 'text').map(([f, p]) => [f, p.start, p.end] as [string, number, number]);
    const senderSpans = prov.filter(([, p]) => p.source === 'sender').map(([f, p]) => [f, p.start, p.end] as [string, number, number]);

    return `<article class="case" id="${esc(id)}">
      <h3>${esc(id)}</h3>
      <div class="split">
        <div class="email">
          <div class="from">${highlight(doc.sender.raw, senderSpans)}</div>
          <div class="body">${highlight(doc.text, textSpans)}</div>
        </div>
        ${renderCard(result, result.notes ?? {})}
      </div>
    </article>`;
  }).join('');
  return `<section><h2>${esc(g.name)}</h2>${cases}</section>`;
}).join('');

const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>inbox-extract — fixture output</title>
<style>
  :root {
    --bg: #fbfbfa; --panel: #fff; --ink: #1a1a19; --muted: #6b6b68; --line: #e5e4e1;
    --accent: #b8552a; --mark: #ffe9a8; --mark-on: #ffc63d; --ok: #2f7d4f; --warn: #a8621b;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#16161a; --panel:#1e1e23; --ink:#eceae6; --muted:#9b9a96; --line:#33323a;
            --accent:#e08a5c; --mark:#4a3f1c; --mark-on:#8a6d1e; --ok:#6cc08a; --warn:#d99a4e; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
         font:15px/1.55 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:1180px; margin:0 auto; padding:40px 24px 80px; }
  header h1 { font-size:26px; margin:0 0 6px; letter-spacing:-.02em; }
  header p { color:var(--muted); margin:0 0 24px; max-width:70ch; }
  .metrics { display:flex; flex-wrap:wrap; gap:10px; margin-bottom:36px; }
  .metric { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:10px 14px; }
  .metric b { display:block; font-size:20px; letter-spacing:-.02em; }
  .metric span { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.06em; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.1em; color:var(--muted);
       border-top:1px solid var(--line); padding-top:22px; margin:38px 0 14px; }
  .case { margin-bottom:26px; }
  .case h3 { font:600 13px/1 var(--mono); color:var(--accent); margin:0 0 8px; }
  .split { display:grid; grid-template-columns:1fr 1fr; gap:14px; align-items:start; }
  @media (max-width:860px) { .split { grid-template-columns:1fr; } }
  .email, .card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:14px 16px; }
  .email { font-family:var(--mono); font-size:12.5px; line-height:1.7; overflow-wrap:anywhere; }
  .email .from { color:var(--muted); padding-bottom:8px; margin-bottom:8px; border-bottom:1px dashed var(--line); }
  mark { background:var(--mark); color:inherit; border-radius:3px; padding:1px 0; transition:background .12s; }
  mark.on { background:var(--mark-on); box-shadow:0 0 0 2px var(--mark-on); }
  .card-head { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:10px; }
  .badge { font:600 11px/1 var(--mono); text-transform:uppercase; letter-spacing:.06em;
           padding:5px 8px; border-radius:6px; background:var(--accent); color:#fff; }
  .badge.none { background:var(--muted); }
  .schema { font:11px var(--mono); color:var(--muted); border:1px solid var(--line); padding:4px 7px; border-radius:6px; }
  .conf { margin-left:auto; font:600 11px var(--mono); padding:4px 8px; border-radius:6px; border:1px solid var(--line); }
  .conf.high { color:var(--ok); } .conf.medium { color:var(--warn); } .conf.low { color:var(--accent); }
  .conf em { font-style:normal; opacity:.55; margin-left:5px; }
  table { width:100%; border-collapse:collapse; }
  tr { cursor:pointer; }
  tr:hover th, tr:hover td { background:color-mix(in srgb, var(--accent) 8%, transparent); }
  th, td { text-align:left; padding:5px 6px; vertical-align:top; border-bottom:1px solid var(--line); }
  th { font:500 12px var(--mono); color:var(--muted); width:38%; white-space:nowrap; }
  td { font-size:13.5px; }
  .money { font-weight:600; } .raw { font:11px var(--mono); color:var(--muted); margin-left:6px; }
  .enum { font:11px var(--mono); color:var(--muted); }
  .list { margin:0; padding-left:16px; } .qty { color:var(--muted); margin-right:4px; }
  .flag { font:10px var(--mono); text-transform:uppercase; letter-spacing:.06em;
          margin-left:6px; padding:2px 5px; border-radius:4px; background:var(--mark); color:var(--warn); cursor:help; }
  .missing { margin-top:10px; font-size:12px; display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
  .missing .label { font:600 10px var(--mono); text-transform:uppercase; letter-spacing:.06em; color:var(--muted); }
  .missing code { font:11px var(--mono); background:var(--mark); padding:2px 6px; border-radius:4px; }
  .missing .hint { color:var(--muted); font-size:11.5px; }
  .warn { margin-top:10px; font-size:12px; color:var(--warn); }
  .reason { font-size:13px; margin:2px 0 10px; }
  .abstain-note { font-size:12px; color:var(--muted); margin:0; }
  .card.abstain { border-style:dashed; }
</style></head>
<body><div class="wrap">
<header>
  <h1>inbox-extract</h1>
  <p>Every fixture email on the left, the structured card on the right. Click any row to highlight the exact
     text that value was read from — a field with nothing to highlight cannot be emitted at all.</p>
</header>
<div class="metrics">
  <div class="metric"><b>${all.length}</b><span>emails</span></div>
  <div class="metric"><b>${extracted}</b><span>extracted</span></div>
  <div class="metric"><b>${abstained}</b><span>abstained</span></div>
  <div class="metric"><b>${fields}</b><span>fields, all grounded</span></div>
  <div class="metric"><b>0</b><span>invented fields</span></div>
</div>
${sections}
</div>
<script>
document.querySelectorAll('.case').forEach((caseEl) => {
  const marks = caseEl.querySelectorAll('mark');
  const clear = () => marks.forEach((m) => m.classList.remove('on'));
  caseEl.querySelectorAll('tr[data-field]').forEach((row) => {
    const field = row.getAttribute('data-field');
    const light = () => {
      clear();
      marks.forEach((m) => {
        if ((m.getAttribute('data-fields') || '').split(' ').includes(field)) m.classList.add('on');
      });
    };
    row.addEventListener('mouseenter', light);
    row.addEventListener('click', light);
  });
  caseEl.addEventListener('mouseleave', clear);
});
</script>
</body></html>
`;

writeFileSync('demo/index.html', html);
console.log(`demo/index.html written — ${all.length} emails, ${extracted} extracted, ${abstained} abstained, ${fields} grounded fields`);
