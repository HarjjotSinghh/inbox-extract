import type { Money } from '../types.ts';

export interface Span<T> { value: T; index: number; length: number }

const SYMBOL_TO_ISO: Record<string, string> = {
  '₹': 'INR', 'rs': 'INR', 'rs.': 'INR', 'inr': 'INR', 'rupee': 'INR', 'rupees': 'INR',
  '$': 'USD', 'us$': 'USD', 'usd': 'USD',
  '€': 'EUR', 'eur': 'EUR',
  '£': 'GBP', 'gbp': 'GBP',
  'aed': 'AED', 'sgd': 'SGD', 'aud': 'AUD', 'cad': 'CAD', 'jpy': 'JPY', '¥': 'JPY',
};

const PREFIXED =
  /(₹|Rs\.?|INR|US\$|\$|€|£|¥|AED|SGD|AUD|CAD|USD|EUR|GBP|JPY)\s*(\d[\d,  ]*(?:\.\d{1,2})?)(?!\s*%)/i;
const SUFFIXED =
  /(\d[\d,  ]*(?:\.\d{1,2})?)\s*(INR|USD|EUR|GBP|AED|SGD|AUD|CAD|JPY|rupees?)\b/i;

/**
 * Indian digit grouping ("1,81,550") and Western grouping ("18,450.00") both
 * reduce to the same thing once separators are dropped, so no locale guess is
 * needed. Anything with two decimal places keeps them.
 */
export function parseAmount(numeric: string): number | null {
  const cleaned = numeric.replace(/[,  ]/g, '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function iso(token: string): string {
  return SYMBOL_TO_ISO[token.trim().toLowerCase()] ?? token.trim().toUpperCase();
}

export function findMoney(text: string): Span<Money> | null {
  const pre = PREFIXED.exec(text);
  const suf = SUFFIXED.exec(text);

  const preIdx = pre?.index ?? Number.POSITIVE_INFINITY;
  const sufIdx = suf?.index ?? Number.POSITIVE_INFINITY;
  if (preIdx === Number.POSITIVE_INFINITY && sufIdx === Number.POSITIVE_INFINITY) return null;

  const usePrefixed = preIdx <= sufIdx;
  const m = (usePrefixed ? pre : suf) as RegExpExecArray;
  const symbol = usePrefixed ? (m[1] ?? '') : (m[2] ?? '');
  const digits = usePrefixed ? (m[2] ?? '') : (m[1] ?? '');

  const amount = parseAmount(digits);
  if (amount == null) return null;

  const raw = m[0].trim();
  return {
    value: { amount, currency: iso(symbol), raw },
    index: m.index + m[0].indexOf(raw[0] ?? ''),
    length: raw.length,
  };
}

export function findAllMoney(text: string): Array<Span<Money>> {
  const out: Array<Span<Money>> = [];
  let offset = 0;
  let rest = text;
  while (rest) {
    const hit = findMoney(rest);
    if (!hit) break;
    out.push({ ...hit, index: hit.index + offset });
    const advance = hit.index + hit.length;
    offset += advance;
    rest = rest.slice(advance);
  }
  return out;
}
