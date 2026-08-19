import { Doc, type Found } from '../normalize.ts';

/**
 * Identifier rules.
 *
 * Every pattern here requires an explicit cue word or separator. A bare
 * alphanumeric token is never treated as an ID — that is how "Your order from
 * Meghana Foods" avoids yielding an order id of "from".
 */

const hasDigit = (s: string) => /\d/.test(s);

/**
 * Marketing copy is full of tokens that look like identifiers
 * ("booking code SUMMER50", "Reference: PROMO2026", "Order #CART-88213").
 * A real PNR/order/tracking id is almost never a seasonal word plus digits.
 */
const COUPONISH =
  /^(promo|off|offer|save|deal|coupon|cart|lucky|summer|winter|weekend|festive|cashback)[-_]?\d*$/i;

export function looksLikeCoupon(s: string): boolean {
  return COUPONISH.test(s.trim());
}

function precededByUse(doc: Doc, start: number): boolean {
  const before = doc.text.slice(Math.max(0, start - 24), start);
  return /\buse\b[^.\n]*$/i.test(before);
}

function firstValid(
  doc: Doc,
  rule: string,
  patterns: RegExp[],
  accept: (s: string) => boolean = hasDigit,
): Found<string> | null {
  for (const re of patterns) {
    for (const hit of doc.matchAll(rule, re)) {
      if (!accept(hit.value)) continue;
      if (looksLikeCoupon(hit.value)) continue;
      if (precededByUse(doc, hit.start)) continue;
      return hit;
    }
  }
  return null;
}

export function pnr(doc: Doc): Found<string> | null {
  // A PNR is an alphanumeric locator. Letters-only English words ("inside")
  // from "booking ref inside" are not.
  return firstValid(doc, 'id.pnr', [
    /\bPNR\s*(?:no\.?|number)?\s*[:#-]?\s*([A-Z0-9]{5,8})\b/i,
    /\bbooking\s*ref(?:erence)?\s*(?:no\.?|number)?\s*[:#-]?\s*([A-Z0-9]{5,8})\b/i,
  ], (s) => hasDigit(s) && /[A-Z]/i.test(s));
}

export function orderId(doc: Doc): Found<string> | null {
  return firstValid(doc, 'id.order', [
    /\border\s*(?:id|no\.?|number)?\s*[:#]\s*([A-Z0-9][A-Z0-9\-/]{3,})/i,
    /\border\s*(?:id|no\.?|number)\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/]{3,})/i,
  ]);
}

export function trackingId(doc: Doc): Found<string> | null {
  return firstValid(doc, 'id.tracking', [
    /\btracking\s*(?:id|no\.?|number|code)?\s*[:#]\s*([A-Z0-9][A-Z0-9\-]{5,})/i,
    /\b(?:awb|consignment)\s*(?:no\.?|number)?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-]{5,})/i,
  ]);
}

export function bookingId(doc: Doc): Found<string> | null {
  return firstValid(doc, 'id.booking', [
    /\bbooking\s*(?:id|reference|ref|no\.?|number|code)\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/]{3,})/i,
    /\bticket\s*(?:id|no\.?|number)\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/]{3,})/i,
  ]);
}

export function appointmentId(doc: Doc): Found<string> | null {
  return firstValid(doc, 'id.appointment', [
    /\bappointment\s*(?:id|no\.?|number|ref(?:erence)?|code)\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/]{3,})/i,
    /\b(?:visit|case)\s*(?:id|no\.?|number)\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/]{3,})/i,
    /\bref(?:erence)?\s*(?:id|no\.?|number|code)?\s*[:#]\s*([A-Z0-9][A-Z0-9\-/]{3,})/i,
  ]);
}

export function confirmationId(doc: Doc): Found<string> | null {
  return firstValid(doc, 'id.confirmation', [
    /\b(?:confirmation|reservation)\s*(?:id|code|no\.?|number)\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/]{3,})/i,
  ]);
}

/** Last four of a card. Masked prefixes (XXXX, ****, ••••) are tolerated and dropped. */
export function cardLast4(doc: Doc): Found<string> | null {
  return firstValid(doc, 'id.cardLast4', [
    /\bcard\s+(?:ending|ending\s+in|no\.?|number)\s*[:#]?\s*(?:[x*•●]{2,}[\s-]*)?(\d{4})\b/i,
    /\bending\s+(?:in\s+)?(?:[x*•●]{2,}[\s-]*)?(\d{4})\b/i,
    /\bcard\s*[:#]\s*(?:[x*•●]{2,}[\s-]*)(\d{4})\b/i,
    /\bcard\s+(?:no\.?|number\s+)?[x*•●]{3,}[\s-]*(\d{4})\b/i,
  ]);
}

/**
 * Account/consumer number. Masked forms ("98•••••21") are kept verbatim —
 * un-masking would be inventing digits.
 */
export function accountNumber(doc: Doc): Found<string> | null {
  return firstValid(doc, 'id.account', [
    /\b(?:account|consumer|customer|connection|subscriber)\s*(?:number|no\.?|id)\s*[:#]?\s*([0-9A-Z][0-9A-Z•●*x\-]{3,})/i,
    /\b(?:account|consumer|connection)\s*[:#]?\s*([0-9][0-9A-Z•●*x\-]{3,})/i,
  ], (s) => /[0-9]/.test(s));
}

export function flightNumber(doc: Doc): Found<string> | null {
  const hit = firstValid(doc, 'id.flightNumber', [
    /\bflight\s*(?:no\.?|number)?\s*[:#]?\s*([A-Z0-9]{2}[\s-]?\d{1,4})\b/i,
    /\b([A-Z]{2}[\s-]?\d{2,4})\b(?=.*\b(?:PNR|depart|arriv|seat)\b)/i,
  ], (s) => /\d/.test(s));
  return hit;
}

function iata(hit: Found<string> | null): Found<string> | null {
  return hit ? { ...hit, value: hit.value.toUpperCase() } : null;
}

/** IATA airport codes read from the "City (CODE)" form used by every airline. */
export function airports(doc: Doc): { from: Found<string> | null; to: Found<string> | null } {
  const from = iata(doc.match('id.airport.from', /\bfrom\s+[A-Za-z .'-]{2,30}\(([A-Z]{3})\)/i));
  const to = iata(doc.match('id.airport.to', /\bto\s+[A-Za-z .'-]{2,30}\(([A-Z]{3})\)/i));
  if (from || to) return { from, to };
  const pair = doc.match('id.airport.pair', /\b([A-Z]{3})\s*(?:→|->|-|to)\s*([A-Z]{3})\b/, 0);
  if (!pair) return { from: null, to: null };
  const m = /\b([A-Z]{3})\s*(?:→|->|-|to)\s*([A-Z]{3})\b/.exec(pair.value);
  if (!m) return { from: null, to: null };
  const a = (m[1] ?? '').toUpperCase();
  const b = (m[2] ?? '').toUpperCase();
  return {
    from: { value: a, quote: m[1] ?? a, start: pair.start, end: pair.start + a.length, source: 'text', rule: 'id.airport.pair' },
    to: { value: b, quote: m[2] ?? b, start: pair.start + pair.value.lastIndexOf(m[2] ?? b), end: pair.start + pair.value.lastIndexOf(m[2] ?? b) + b.length, source: 'text', rule: 'id.airport.pair' },
  };
}
