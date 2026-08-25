import * as ids from '../parse/ids.ts';
import { parseItems } from '../parse/items.ts';
import { dateFromLabel, moneyFromLabel } from '../parse/locate.ts';
import { cleanTitle, first, labelValue, mapFound } from '../parse/text.ts';
import { ORDER_STATUS, SCHEMA } from '../schema.ts';
import { Draft, senderBrand, type Extractor, type ExtractorContext } from './base.ts';

const REQUIRED = ['merchant', 'orderId', 'items', 'total', 'status'] as const;

/**
 * Same schema.org type as `food` (Order), and deliberately not merged with it:
 * the discriminator is the delivery horizon, not a vendor allowlist, because a
 * vendor list would not generalise to a merchant this hasn't seen. `food` is a
 * clock-time ETA on the same day; `shopping` states a multi-day expected
 * delivery date. See DECISIONS.md.
 */
export const shopping: Extractor = {
  category: 'shopping',
  schemaType: SCHEMA.order,
  required: REQUIRED,
  strongAnchor: [['orderId']],
  softAnchor: [['orderId'], ['merchant', 'items']],

  run({ doc }: ExtractorContext) {
    const d = new Draft();

    d.set('merchant', first(
      mapFound(doc.match('shopping.merchant.from', /\border\s+from\s+([A-Z][\w&.'-]*(?:\s+[\w&.'-]+){0,4}?)(?=\s+(?:is|has|was|will)\b|[,.!]|$)/), 'clean', cleanTitle),
      senderBrand(doc, 'shopping.merchant.sender'),
    ));

    d.set('orderId', ids.orderId(doc));
    d.set('items', parseItems(labelValue(doc, 'shopping.items', ['Items', 'Item', 'Order details', 'Your order'], { multiline: true })));

    d.set('total', first(
      moneyFromLabel(doc, 'shopping.total', ['Grand total', 'Order total', 'Total amount', 'Total', 'Amount paid'], {
        notPartOf: ['Item total', 'Items total', 'Subtotal', 'Total savings'],
      }),
    ));

    const statusHit = doc.match('shopping.status', /\b(order\s+placed|confirmed|packed|shipped|dispatched|out\s+for\s+delivery|delivered|cancell?ed)\b/i);
    if (statusHit) {
      d.derive('status', statusHit.value.toLowerCase().replace(/\s+/g, '-'), statusHit, 'shopping.status');
      const v = statusHit.value.toLowerCase();
      const mapped = v.includes('deliver') && !v.includes('out for')
        ? ORDER_STATUS.delivered
        : v.includes('cancel')
          ? ORDER_STATUS.cancelled
          : v.includes('ship') || v.includes('dispatch') || v.includes('out for')
            ? ORDER_STATUS.inTransit
            : ORDER_STATUS.processing;
      d.derive('orderStatus', mapped, statusHit, 'shopping.orderStatus');
    }

    const eta = dateFromLabel(doc, 'shopping.eta', ['Expected delivery', 'Estimated delivery', 'Arriving by', 'Delivery by']);
    if (eta) d.derive('expectedDelivery', eta.value.value, eta, 'shopping.expectedDelivery');

    return d.finish({ required: REQUIRED });
  },
};
