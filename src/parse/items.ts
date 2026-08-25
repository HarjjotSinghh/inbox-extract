import type { Found } from '../normalize.ts';
import type { LineItem } from '../types.ts';
import { findAllMoney } from './money.ts';
import { cleanTitle } from './text.ts';

/**
 * Line items.
 *
 * Segments are split first, then each is read independently — an earlier
 * version bailed out of the fallback as soon as *any* segment matched the
 * "2x Coke" shape, so "Chicken Biryani, 2x Coke, Paneer Tikka" silently
 * became a one-item order. Quantity is attached only where it is written.
 */
function parseOneItem(segment: string): LineItem | null {
  const priced = /\(([^)]*\d[^)]*)\)\s*$/.exec(segment);
  const price = priced?.[1] ? findAllMoney(priced[1])[0]?.value : undefined;
  const core = (priced ? segment.slice(0, priced.index) : segment).trim();

  let quantity: number | undefined;
  let name = core;

  const leading = /^(\d+)\s*[x×]\s+(.+)$/i.exec(core);
  const trailing = /^(.+?)\s+[x×]\s*(\d+)$/i.exec(core);
  const parens = /^\((\d+)\)\s*(.+)$/.exec(core);
  const qtyLabel = /^qty\.?\s*[:\s]\s*(\d+)\s+(.+)$/i.exec(core);

  if (leading) { quantity = Number(leading[1]); name = leading[2] ?? core; }
  else if (parens) { quantity = Number(parens[1]); name = parens[2] ?? core; }
  else if (qtyLabel) { quantity = Number(qtyLabel[1]); name = qtyLabel[2] ?? core; }
  else if (trailing) { quantity = Number(trailing[2]); name = trailing[1] ?? core; }

  const cleaned = cleanTitle(name);
  if (!cleaned || cleaned.length > 80) return null;
  return { name: cleaned, ...(quantity ? { quantity } : {}), ...(price ? { price } : {}) };
}

/**
 * Split on comma/semicolon/newline, but not a comma inside parentheses — a
 * naive split turned "1x Cotton Shirt (₹1,299)" into two fake items at the
 * thousands-separator comma.
 */
function splitSegments(text: string): string[] {
  const segments: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === '\n' || ch === ';' || (ch === ',' && depth === 0)) {
      segments.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  segments.push(current);
  return segments;
}

export function parseItems(span: Found<string> | null): Found<LineItem[]> | null {
  if (!span) return null;
  const items = splitSegments(span.value)
    .map((seg) => seg.trim())
    .filter(Boolean)
    .map(parseOneItem)
    .filter((i): i is LineItem => i !== null);
  return items.length ? { ...span, value: items, rule: `${span.rule}>items` } : null;
}
