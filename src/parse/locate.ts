import type { Doc, Found } from '../normalize.ts';
import type { Money } from '../types.ts';
import { findDateTime, type DateHit } from './datetime.ts';
import { findMoney } from './money.ts';
import { labelValue, refine, type LabelOptions } from './text.ts';

/** Narrow an already-located span down to the date it contains. */
function toDate(src: Found<string> | null, rule: string): Found<DateHit> | null {
  return refine(src, rule, (s) => {
    const hit = findDateTime(s);
    return hit ? { value: hit.value, index: hit.index, length: hit.length } : null;
  });
}

function toMoney(src: Found<string> | null, rule: string): Found<Money> | null {
  return refine(src, rule, (s) => {
    const hit = findMoney(s);
    return hit ? { value: hit.value, index: hit.index, length: hit.length } : null;
  });
}

export function dateFromLabel(doc: Doc, rule: string, labels: string[], opts?: LabelOptions): Found<DateHit> | null {
  return toDate(labelValue(doc, rule, labels, opts), 'date');
}

export function dateFromPattern(doc: Doc, rule: string, re: RegExp, group = 1): Found<DateHit> | null {
  return toDate(doc.match(rule, re, group), 'date');
}

/** First date-like span anywhere in the email. Last resort — prefer a labelled one. */
export function firstDate(doc: Doc, rule: string): Found<DateHit> | null {
  const hit = findDateTime(doc.text);
  if (!hit) return null;
  const quote = doc.text.slice(hit.index, hit.index + hit.length);
  return { value: hit.value, quote, start: hit.index, end: hit.index + quote.length, source: 'text', rule };
}

export function moneyFromLabel(doc: Doc, rule: string, labels: string[], opts?: LabelOptions): Found<Money> | null {
  return toMoney(labelValue(doc, rule, labels, opts), 'money');
}

export function moneyFromPattern(doc: Doc, rule: string, re: RegExp, group = 1): Found<Money> | null {
  return toMoney(doc.match(rule, re, group), 'money');
}

export function textFromLabel(doc: Doc, rule: string, labels: string[], opts?: LabelOptions): Found<string> | null {
  return labelValue(doc, rule, labels, opts);
}

export { labelValue, refine };
export type { LabelOptions };
