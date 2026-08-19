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

function parseItems(span: Found<string> | null): Found<LineItem[]> | null {
  if (!span) return null;
  const items = span.value
    .split(/\s*[,;\n]\s*/)
    .map((seg) => seg.trim())
    .filter(Boolean)
    .map(parseOneItem)
    .filter((i): i is LineItem => i !== null);
  return items.length ? { ...span, value: items, rule: `${span.rule}>items` } : null;
}

export const food: Extractor = {
  category: 'food',
  schemaType: SCHEMA.order,
  required: REQUIRED,
  strongAnchor: [['orderId']],
  softAnchor: [['orderId'], ['merchant', 'total']],

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
    d.set('items', parseItems(labelValue(doc, 'food.items', ['Items', 'Item', 'Order details', 'Your order'], { multiline: true })));

    d.set('total', first(
      moneyFromLabel(doc, 'food.total', ['Grand total', 'Order total', 'Bill total', 'Total amount', 'Total', 'Amount paid'], {
        notPartOf: ['Item total', 'Items total', 'Subtotal', 'Total savings'],
      }),
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

    return d.finish({ required: REQUIRED });
  },
};
