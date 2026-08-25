import { dateFromLabel, moneyFromLabel } from '../parse/locate.ts';
import { parseItems } from '../parse/items.ts';
import { cleanTitle, first, labelValue, mapFound } from '../parse/text.ts';
import { ORDER_STATUS, SCHEMA } from '../schema.ts';
import * as ids from '../parse/ids.ts';
import { Draft, senderBrand, type Extractor, type ExtractorContext } from './base.ts';

const REQUIRED = ['merchant', 'orderId', 'items', 'total', 'status', 'eta'] as const;

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

    // A terminal state (cancelled/delivered) outranks an earlier progress
    // mention wherever it sits — "order was placed ... later cancelled" is a
    // cancellation, and first-match-wins would report 'placed'. Same
    // precedence refund.ts already applies to cancelled-vs-refunded.
    const statusHit = first(
      doc.match('food.status.terminal', /\b(delivered|cancell?ed)\b/i),
      doc.match('food.status', /\b(on\s+the\s+way|out\s+for\s+delivery|being\s+prepared|preparing|placed|confirmed)\b/i),
    );
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
