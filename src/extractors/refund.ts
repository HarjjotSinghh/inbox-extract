import type { Found } from '../normalize.ts';
import * as ids from '../parse/ids.ts';
import { moneyFromLabel, moneyFromPattern } from '../parse/locate.ts';
import { findAllMoney } from '../parse/money.ts';
import { cleanTitle, first, labelValue, mapFound } from '../parse/text.ts';
import { ORDER_STATUS, SCHEMA } from '../schema.ts';
import { Draft, senderBrand, type Extractor, type ExtractorContext } from './base.ts';

const REQUIRED = ['merchant', 'orderId', 'item', 'amount', 'status', 'eta'] as const;

/** The only money figure in the email, when there is exactly one. */
function soleAmount(doc: ExtractorContext['doc']): Found<import('../types.ts').Money> | null {
  const all = findAllMoney(doc.text);
  const only = all.length === 1 ? all[0] : undefined;
  if (!only) return null;
  const quote = doc.text.slice(only.index, only.index + only.length);
  return { value: only.value, quote, start: only.index, end: only.index + only.length, source: 'text', rule: 'refund.amount.sole' };
}

export const refund: Extractor = {
  category: 'refund',
  schemaType: SCHEMA.order,
  required: REQUIRED,

  run({ doc }: ExtractorContext) {
    const d = new Draft();

    d.set('merchant', first(
      mapFound(labelValue(doc, 'refund.merchant', ['Merchant', 'Seller', 'Store']), 'clean', cleanTitle),
      senderBrand(doc, 'refund.merchant.sender'),
    ));

    d.set('orderId', ids.orderId(doc));

    d.set('item', first(
      mapFound(doc.match('refund.item.paren', /\border\s*#?\s*[A-Z0-9][A-Z0-9\-/]{3,}\s*\(([^)]{3,90})\)/i), 'clean', cleanTitle),
      mapFound(labelValue(doc, 'refund.item', ['Item', 'Product', 'Item name', 'For']), 'clean', cleanTitle),
      mapFound(doc.match('refund.item.quoted', /\bfor\s+['"“‘]([^'"”’]{3,90})['"”’]/i), 'clean', cleanTitle),
    ));

    d.set('amount', first(
      moneyFromPattern(doc, 'refund.amount.of', /\b(?:refund|credit|reversal)\s+of\s+([^.\n]{1,40})/i),
      moneyFromLabel(doc, 'refund.amount', ['Refund amount', 'Amount refunded', 'Refunded amount', 'Amount']),
      // "₹3,499 will be credited back ..." — the amount leads the verb.
      moneyFromPattern(doc, 'refund.amount.credited', /((?:₹|Rs\.?|INR|\$|€|£)\s*[\d,]+(?:\.\d{1,2})?)\s+(?:\w+\s+){0,3}?(?:credited|refunded|returned|reversed|reflected)/i),
      // Last resort: exactly one amount in the whole email leaves nothing to
      // choose between, so there is no guess to get wrong.
      soleAmount(doc),
    ));

    // Cancellation outranks refund wording. "Your order has been cancelled,
    // ₹3,499 will be credited back" is a cancellation whose consequence is a
    // refund — reporting it as merely 'refunded' loses the fact that the order
    // is gone, which is the part the user acts on.
    const cancelled = doc.match('refund.status.cancelled', /\b(cancell?ed|cancellation)\b/i);
    const refunded = doc.match('refund.status.refunded', /\b(refund(?:ed)?|reversed|credited\s+back)\b/i);
    if (cancelled) d.derive('status', 'cancelled', cancelled, 'refund.status');
    else if (refunded) d.derive('status', 'refunded', refunded, 'refund.status');

    if (d.data.status === 'refunded') d.derive('orderStatus', ORDER_STATUS.returned, refunded, 'refund.orderStatus');
    else if (d.data.status === 'cancelled') d.derive('orderStatus', ORDER_STATUS.cancelled, cancelled, 'refund.orderStatus');

    // "within 3–5 business days" is a relative window. Turning it into a date
    // needs a send date and a business-day calendar; neither is in the email,
    // so it stays verbatim and is flagged partial.
    const relativeEta = doc.match(
      'refund.eta.relative',
      /\bwithin\s+([^.\n]{1,40}?(?:business\s+days?|working\s+days?|days?|hours?|weeks?))/i,
    );
    const absoluteEta = labelValue(doc, 'refund.eta', ['Refund date', 'Expected by', 'Credited by']);
    if (relativeEta) {
      d.set('eta', mapFound(relativeEta, 'clean', cleanTitle));
      d.markPartial('eta', 'Stated as a relative window, not a date. Resolving it would require the message send date and a business-day calendar, neither of which is in the email.');
    } else if (absoluteEta) {
      d.set('eta', mapFound(absoluteEta, 'clean', cleanTitle));
    }

    return d.finish({
      required: REQUIRED,
      anchorStrong: d.has('orderId') && d.has('amount'),
      anchorSatisfied: d.has('amount') && d.has('status'),
    });
  },
};
