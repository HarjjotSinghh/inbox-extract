import { Doc, type Found } from '../normalize.ts';

/**
 * Identifier rules.
 *
 * Every pattern here requires an explicit cue word or separator. A bare
 * alphanumeric token is never treated as an ID — that is how "Your order from
 * Meghana Foods" avoids yielding an order id of "from".
 */

const hasDigit = (s: string) => /\d/.test(s);

function firstValid(
  doc: Doc,
  rule: string,
  patterns: RegExp[],
  accept: (s: string) => boolean = hasDigit,
): Found<string> | null {
  for (const re of patterns) {
    for (const hit of doc.matchAll(rule, re)) {
      if (accept(hit.value)) return hit;
    }
  }
  return null;
}

export function pnr(doc: Doc): Found<string> | null {
  return firstValid(doc, 'id.pnr', [
    /\bPNR\s*(?:no\.?|number)?\s*[:#-]?\s*([A-Z0-9]{5,8})\b/i,
    /\bbooking\s*ref(?:erence)?\s*(?:no\.?|number)?\s*[:#-]?\s*([A-Z0-9]{5,8})\b/i,
  ], (s) => /[A-Z]/i.test(s) || hasDigit(s));
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

/** IATA airport codes read from the "City (CODE)" form used by every airline. */
export function airports(doc: Doc): { from: Found<string> | null; to: Found<string> | null } {
  const from = doc.match('id.airport.from', /\bfrom\s+[A-Za-z .'-]{2,30}\(([A-Z]{3})\)/);
  const to = doc.match('id.airport.to', /\bto\s+[A-Za-z .'-]{2,30}\(([A-Z]{3})\)/);
  if (from || to) return { from, to };
  const pair = doc.match('id.airport.pair', /\b([A-Z]{3})\s*(?:→|->|-|to)\s*([A-Z]{3})\b/, 0);
  if (!pair) return { from: null, to: null };
  const m = /\b([A-Z]{3})\s*(?:→|->|-|to)\s*([A-Z]{3})\b/.exec(pair.value);
  if (!m) return { from: null, to: null };
  const a = m[1] ?? '';
  const b = m[2] ?? '';
  return {
    from: { value: a, quote: a, start: pair.start, end: pair.start + a.length, source: 'text', rule: 'id.airport.pair' },
    to: { value: b, quote: b, start: pair.start + pair.value.lastIndexOf(b), end: pair.start + pair.value.lastIndexOf(b) + b.length, source: 'text', rule: 'id.airport.pair' },
  };
}
