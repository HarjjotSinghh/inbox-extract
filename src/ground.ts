import type { Doc } from './normalize.ts';
import type { Money, Provenance } from './types.ts';

export interface GroundingReport {
  checked: number;
  dropped: Array<{ field: string; reason: string }>;
  repaired: string[];
}

/** Loose comparison used only to confirm a value came out of its own quote. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‐-―]/g, '-')
    .replace(/[^a-z0-9]+/g, '');
}

function isMoney(v: unknown): v is Money {
  return typeof v === 'object' && v !== null && 'amount' in v && 'currency' in v && 'raw' in v;
}

/**
 * Checking that `raw` sits inside the quote is not enough: `amount` is a parsed
 * number, and a parser bug can put a figure in `amount` that `raw` does not
 * support. Re-deriving the number from `raw` closes that gap, so "no field is
 * invented" holds for the value and not merely for the span.
 */
function amountMatchesRaw(m: Money): boolean {
  const digits = /(\d[\d,\u00a0\u202f\u2009]*(?:\.\d{1,2})?)/.exec(m.raw)?.[1];
  if (!digits) return false;
  const reparsed = Number(digits.replace(/[,\u00a0\u202f\u2009]/g, ''));
  return Number.isFinite(reparsed) && reparsed === m.amount;
}

function valueStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'number') return [String(value)];
  if (isMoney(value)) return [value.raw];
  if (Array.isArray(value)) return value.flatMap(valueStrings);
  if (typeof value === 'object' && value !== null) {
    const o = value as Record<string, unknown>;
    // Line items: the name is the part that must appear in the email.
    if (typeof o.name === 'string') return [o.name];
    return [];
  }
  return [];
}

/**
 * The anti-hallucination gate.
 *
 * Every emitted field must point at a span that exists verbatim in the email,
 * and — unless the value is an explicit normalisation of that span — the value
 * itself must be recoverable from it. Fields that fail are deleted from `data`
 * before it is ever returned, so a hallucinated field cannot reach a caller;
 * the worst case is a field that shows up in `missing` instead.
 */
export function ground(
  doc: Doc,
  data: Record<string, unknown>,
  provenance: Record<string, Provenance>,
): GroundingReport {
  const report: GroundingReport = { checked: 0, dropped: [], repaired: [] };

  for (const field of Object.keys(data)) {
    const p = provenance[field];
    if (!p) {
      delete data[field];
      report.dropped.push({ field, reason: 'no provenance recorded' });
      continue;
    }
    report.checked += 1;

    // JSON-LD comes from the sender as structured data; there is no prose span
    // to point at, and re-deriving it from prose would be strictly worse.
    if (p.source === 'jsonld' || p.source === 'microdata') continue;

    const haystack = p.source === 'sender' ? doc.sender.raw : doc.text;

    if (haystack.slice(p.start, p.end) !== p.quote) {
      const at = haystack.indexOf(p.quote);
      if (at < 0) {
        delete data[field];
        delete provenance[field];
        report.dropped.push({ field, reason: `quote not present in ${p.source}: ${JSON.stringify(p.quote)}` });
        continue;
      }
      p.start = at;
      p.end = at + p.quote.length;
      report.repaired.push(field);
    }

    // Money is checked even when derived: the number is the whole point.
    const value = data[field];
    if (isMoney(value) && !amountMatchesRaw(value)) {
      delete data[field];
      delete provenance[field];
      report.dropped.push({
        field,
        reason: `amount ${value.amount} is not derivable from raw ${JSON.stringify(value.raw)}`,
      });
      continue;
    }

    if (p.derived) continue; // a normalisation of a verified quote

    const quoteNorm = norm(p.quote);
    const parts = valueStrings(data[field]);
    const orphan = parts.find((v) => v.length > 0 && !quoteNorm.includes(norm(v)));
    if (orphan !== undefined) {
      delete data[field];
      delete provenance[field];
      report.dropped.push({
        field,
        reason: `value ${JSON.stringify(orphan)} is not contained in its quote ${JSON.stringify(p.quote)}`,
      });
    }
  }

  return report;
}
