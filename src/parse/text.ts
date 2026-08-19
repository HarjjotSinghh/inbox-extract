import { Doc, found, type Found } from '../normalize.ts';

/**
 * Tokens that end in '.' without ending a sentence. Without this guard,
 * "Doctor: Dr. Anita Rao" truncates to "Dr".
 */
const ABBREV =
  /(?:^|\s)(?:Dr|Mr|Mrs|Ms|Prof|Sr|Jr|St|Rd|Ave|Blvd|No|Nos|Inc|Ltd|Pvt|Co|Corp|vs|approx|Est|Apt|Ext|Sq|Ft|Mt|Rs|a\.m|p\.m|[A-Z])\.$/;

/**
 * Walk forward from `from` to the end of a label's value.
 *
 * Terminates on a newline or a genuine sentence break. A '.' only breaks when
 * the next non-space character starts something new (uppercase, digit, or a
 * currency symbol) and the token before it is not a known abbreviation.
 */
export function valueEnd(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === '\n') return i;
    if (c !== '.' && c !== '!' && c !== '?') continue;

    const rest = text.slice(i + 1);
    if (rest === '') return i;
    if (!/^\s/.test(rest)) continue; // "3.5" or "amazon.in" — not a break
    if (ABBREV.test(text.slice(Math.max(0, i - 12), i + 1))) continue;

    const after = rest.replace(/^\s+/, '');
    if (after === '' || /^[A-Z0-9₹$€£]/.test(after)) return i;
  }
  return text.length;
}

/**
 * End of a value that may span lines: stops at a blank line or at the next
 * "Label:" line, so an item list survives but the field after it is not eaten.
 */
export function valueEndMultiline(text: string, from: number): number {
  let end = valueEnd(text, from);
  while (end < text.length && text[end] === '\n') {
    const lineStart = end + 1;
    const nl = text.indexOf('\n', lineStart);
    const line = text.slice(lineStart, nl < 0 ? text.length : nl);
    if (!line.trim()) break;
    if (/^\s*[A-Z][\w &/'-]{1,24}\s*:/.test(line)) break;
    end = valueEnd(text, lineStart);
  }
  return end;
}

function labelPattern(label: string): string {
  return label
    .trim()
    .split(/\s+/)
    .map((token) =>
      // "Date & time" and "Date and time" are the same label to a reader, and
      // vendors use both spellings interchangeably.
      token === '&' || token.toLowerCase() === 'and'
        ? '(?:&|and)'
        : token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('\\s*');
}

/**
 * Vendor-agnostic layer: find "Label: value" anywhere in the email.
 *
 * Labels are tried most-specific-first, so ["Payment due date", "Due date"]
 * resolves HDFC's "Statement date ... Payment due date" correctly.
 */
export interface LabelOptions {
  /**
   * Let the value run past a newline. Item lists are routinely written one per
   * line; stopping at the first newline silently truncates them to one item.
   */
  multiline?: boolean;
  /**
   * Longer phrases this label must not be read out of.
   *
   * "Available credit limit" ends in "credit limit"; without this guard a
   * `creditLimit` field would silently claim a total limit the email never
   * states. Real emails are full of these nested labels.
   */
  notPartOf?: string[];
}

/** Spans covered by any of the given phrases, used to veto nested-label matches. */
function coveredSpans(text: string, phrases: string[]): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const phrase of phrases) {
    const re = new RegExp(labelPattern(phrase), 'gi');
    for (const m of text.matchAll(re)) {
      if (m.index != null) spans.push([m.index, m.index + m[0].length]);
    }
  }
  return spans;
}

export function labelValue(
  doc: Doc,
  rule: string,
  labels: string[],
  opts: LabelOptions = {},
): Found<string> | null {
  const blocked = opts.notPartOf?.length ? coveredSpans(doc.text, opts.notPartOf) : [];

  for (const label of labels) {
    const re = new RegExp(
      `(?:^|[\\n.;!?()]\\s*|\\s)(${labelPattern(label)})\\s*(?::|-|–|—|\\bis\\b)\\s*`,
      'gi',
    );
    for (const m of doc.text.matchAll(re)) {
      if (m.index == null) continue;
      const labelStart = m.index + m[0].indexOf(m[1] ?? '');
      if (blocked.some(([s, e]) => labelStart >= s && labelStart < e)) continue;
      const valueStart = m.index + m[0].length;
      const stop = opts.multiline ? valueEndMultiline : valueEnd;
      const raw = doc.text.slice(valueStart, stop(doc.text, valueStart));
      const trimmed = raw.replace(/[\s,;]+$/, '');
      if (!trimmed) continue;
      return found(trimmed, trimmed, valueStart, `${rule}:label(${label})`);
    }
  }
  return null;
}

/**
 * Re-run a finer parser inside an already-located span, keeping absolute offsets.
 *
 * This is how a label hit ("Total: ₹380") narrows to the money span ("₹380")
 * without ever losing the link back to the source text.
 */
export function refine<T>(
  src: Found<string> | null,
  rule: string,
  fn: (s: string) => { value: T; index: number; length: number } | null,
): Found<T> | null {
  if (!src) return null;
  const hit = fn(src.value);
  if (!hit) return null;
  const quote = src.value.slice(hit.index, hit.index + hit.length);
  return {
    value: hit.value,
    quote,
    start: src.start + hit.index,
    end: src.start + hit.index + hit.length,
    source: src.source,
    rule: `${src.rule}>${rule}`,
  };
}

/** Map a Found's value without moving its span. Use only for normalisations. */
export function mapFound<A, B>(src: Found<A> | null, rule: string, fn: (a: A) => B | null): Found<B> | null {
  if (!src) return null;
  const value = fn(src.value);
  if (value == null || value === '') return null;
  return { ...src, value, rule: `${src.rule}>${rule}` };
}

/** First non-null. Keeps extractor bodies readable as a priority list. */
export function first<T>(...cands: Array<Found<T> | null>): Found<T> | null {
  for (const c of cands) if (c) return c;
  return null;
}

export function cleanTitle(s: string): string {
  return s
    .replace(/^["'“‘]+|["'”’]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[\s,.;:–—-]+$/, '')
    .trim();
}

/** Locate a known substring inside a span, for use with `refine`. */
export function sliceOf(haystack: string, needle: string): { value: string; index: number; length: number } | null {
  const trimmed = needle.trim();
  if (!trimmed) return null;
  const index = haystack.indexOf(trimmed);
  return index < 0 ? null : { value: trimmed, index, length: trimmed.length };
}

/**
 * Merge two spans into the contiguous stretch that covers both.
 *
 * A composed value ("2026-09-12T08:15" from a date here and a clock time there)
 * should point at text that justifies all of it, not just its last component.
 * Returns null when the spans are too far apart for the span between them to be
 * fair to quote.
 */
export function spanUnion(
  text: string,
  a: Found<unknown> | null,
  b: Found<unknown> | null,
  maxGap = 120,
): { quote: string; start: number; end: number } | null {
  if (!a || !b || a.source !== b.source) return null;
  const start = Math.min(a.start, b.start);
  const end = Math.max(a.end, b.end);
  if (end - start > maxGap) return null;
  return { quote: text.slice(start, end), start, end };
}
