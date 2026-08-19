import type { Found } from '../normalize.ts';
import { findAllMoney } from '../parse/money.ts';
import { dateFromLabel, moneyFromLabel } from '../parse/locate.ts';
import { cleanTitle, first, labelValue, mapFound } from '../parse/text.ts';
import { ORDER_STATUS, SCHEMA } from '../schema.ts';
import type { LineItem } from '../types.ts';
import * as ids from '../parse/ids.ts';
import { Draft, senderBrand, type Extractor, type ExtractorContext } from './base.ts';

const REQUIRED = ['merchant', 'orderId', 'items', 'total', 'status', 'eta'] as const;

/**
 * Line items from the two forms vendors actually use:
 *   "1x Chicken Biryani (₹320), 1x Coke (₹60)"
 *   "Chicken Biryani x 1, Coke x 1"
 * Prices are attached only when the email states them per item.
 */
function parseItems(span: Found<string> | null): Found<LineItem[]> | null {
  if (!span) return null;
  const items: LineItem[] = [];

  const leading = /(\d+)\s*[x×]\s*([^(,;]+?)\s*(?:\(([^)]+)\))?(?=\s*[,;]|$)/gi;
  for (const m of span.value.matchAll(leading)) {
    const name = cleanTitle(m[2] ?? '');
    if (!name) continue;
    const price = m[3] ? findAllMoney(m[3])[0]?.value : undefined;
    items.push({ name, quantity: Number(m[1]), ...(price ? { price } : {}) });
  }

  if (items.length === 0) {
    const trailing = /([^,;(]+?)\s*[x×]\s*(\d+)\s*(?:\(([^)]+)\))?(?=\s*[,;]|$)/gi;
    for (const m of span.value.matchAll(trailing)) {
      const name = cleanTitle(m[1] ?? '');
      if (!name) continue;
      const price = m[3] ? findAllMoney(m[3])[0]?.value : undefined;
      items.push({ name, quantity: Number(m[2]), ...(price ? { price } : {}) });
    }
  }

  // A bare comma-separated list is still a list; quantity is simply not stated.
  if (items.length === 0) {
    for (const part of span.value.split(/\s*[,;]\s*/)) {
      const name = cleanTitle(part);
      if (name && name.length <= 80) items.push({ name });
    }
  }

  return items.length ? { ...span, value: items, rule: `${span.rule}>items` } : null;
}

export const food: Extractor = {
  category: 'food',
  schemaType: SCHEMA.order,
  required: REQUIRED,

  run({ doc }: ExtractorContext) {
    const d = new Draft();

    // The restaurant is the merchant; the app is the platform. Collapsing the
    // two would put "Zomato" on a card that should say "Meghana Foods".
    d.set('merchant', first(
      mapFound(doc.match('food.merchant.from', /\border\s+from\s+([A-Z][\w&.'-]*(?:\s+[\w&.'-]+){0,4}?)(?=\s+(?:is|has|was|will)\b|[,.!]|$)/), 'clean', cleanTitle),
      mapFound(labelValue(doc, 'food.merchant', ['Restaurant', 'Merchant', 'Store', 'Outlet']), 'clean', cleanTitle),
    ));
    d.set('platform', senderBrand(doc, 'food.platform.sender'));

    d.set('orderId', ids.orderId(doc));
    d.set('items', parseItems(labelValue(doc, 'food.items', ['Items', 'Item', 'Order details', 'Your order'])));

    d.set('total', first(
      moneyFromLabel(doc, 'food.total', ['Grand total', 'Order total', 'Bill total', 'Total amount', 'Total', 'Amount paid']),
    ));

    const statusHit = doc.match('food.status', /\b(on\s+the\s+way|out\s+for\s+delivery|being\s+prepared|preparing|delivered|order\s+placed|confirmed|cancell?ed)\b/i);
    if (statusHit) {
      d.derive('status', statusHit.value.toLowerCase().replace(/\s+/g, '-'), statusHit, 'food.status');
      const v = statusHit.value.toLowerCase();
      const mapped = v.includes('deliver') && !v.includes('out for')
        ? ORDER_STATUS.delivered
        : v.includes('cancel')
          ? ORDER_STATUS.cancelled
          : v.includes('way') || v.includes('out for')
            ? ORDER_STATUS.inTransit
            : ORDER_STATUS.processing;
      d.derive('orderStatus', mapped, statusHit, 'food.orderStatus');
    }

    const eta = dateFromLabel(doc, 'food.eta', ['Estimated delivery', 'Estimated arrival', 'Expected delivery', 'Arriving by', 'Delivery by', 'ETA']);
    if (eta) {
      d.derive('eta', eta.value.value, eta, 'food.eta');
      if (eta.value.kind === 'time') {
        // "8:45 PM" with no date. The obvious fill is "today", but the email
        // never says today — so the date stays absent and the field is flagged.
        d.markPartial('eta', 'Clock time only. No date is stated in the email, and none was supplied via email.date, so the day is left unresolved rather than assumed.');
      }
    }

    d.set('deliveryAddress', mapFound(labelValue(doc, 'food.address', ['Delivering to', 'Delivery address', 'Deliver to', 'Shipping to']), 'clean', cleanTitle));

    return d.finish({
      required: REQUIRED,
      anchorStrong: d.has('orderId'),
      anchorSatisfied: d.has('orderId') || (d.has('merchant') && d.has('total')),
    });
  },
};
