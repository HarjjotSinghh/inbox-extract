import * as ids from '../parse/ids.ts';
import { dateFromLabel, dateFromPattern } from '../parse/locate.ts';
import { cleanTitle, first, labelValue, mapFound } from '../parse/text.ts';
import { SCHEMA } from '../schema.ts';
import { Draft, senderBrand, type Extractor, type ExtractorContext } from './base.ts';

const REQUIRED = ['carrier', 'trackingId', 'item', 'expectedDelivery', 'orderId'] as const;

export const shipment: Extractor = {
  category: 'shipment',
  schemaType: SCHEMA.parcelDelivery,
  required: REQUIRED,
  strongAnchor: [['trackingId']],
  softAnchor: [['trackingId'], ['orderId', 'item']],

  run({ doc }: ExtractorContext) {
    const d = new Draft();

    // schema.org supersedes `carrier` with `provider` on ParcelDelivery, but the
    // brief names `carrier` and every consumer of this data says carrier, so we
    // emit that and note the alias in DECISIONS.md.
    d.set('carrier', first(
      mapFound(labelValue(doc, 'shipment.carrier', ['Carrier', 'Courier', 'Shipped via', 'Delivery partner', 'Shipping partner']), 'clean', cleanTitle),
      mapFound(doc.match('shipment.carrier.via', /\b(?:shipped|dispatched|sent|delivered)\s+(?:out\s+)?(?:via|through|by|with)\s+([A-Z][A-Za-z0-9 .&'-]{2,28}?)(?=[.,;!]|\s+(?:and|on|to|for)\b|$)/), 'clean', cleanTitle),
    ));

    d.set('trackingId', ids.trackingId(doc));

    d.set('item', first(
      mapFound(doc.match('shipment.item.quoted', /\b(?:item|product|order)\s+(?:of\s+)?['"“‘]([^'"”’]{3,90})['"”’]/i), 'clean', cleanTitle),
      mapFound(labelValue(doc, 'shipment.item', ['Item', 'Product', 'Item shipped', 'Items']), 'clean', cleanTitle),
    ));

    const eta = first(
      dateFromLabel(doc, 'shipment.eta', ['Expected delivery', 'Estimated delivery', 'Expected arrival', 'Delivery date', 'Arriving on', 'Arriving']),
      dateFromPattern(doc, 'shipment.eta.by', /\b(?:arriv\w+|deliver\w+)\s+(?:by|on)\s+([^.\n]{4,40})/i),
    );
    if (eta) {
      d.derive('expectedDelivery', eta.value.value, eta, 'shipment.expectedDelivery');
      if (eta.value.kind === 'time') {
        d.markPartial('expectedDelivery', 'Only a time of day was stated; the email does not give the delivery date.');
      }
    }

    d.set('orderId', ids.orderId(doc));
    d.set('merchant', senderBrand(doc, 'shipment.merchant.sender'));

    const delivered = doc.match('shipment.delivered', /\b(?:has been|was)\s+(delivered)\b/i);
    const inTransit = doc.match('shipment.inTransit', /\b(shipped|dispatched|in transit|on the way|out for delivery)\b/i);
    // schema.org expects a DeliveryEvent here, not an enumeration member, so a
    // plain token is emitted rather than a schema.org URI that would not validate.
    if (delivered) d.derive('deliveryStatus', 'delivered', delivered, 'shipment.status');
    else if (inTransit) d.derive('deliveryStatus', 'in-transit', inTransit, 'shipment.status');

    return d.finish({ required: REQUIRED });
  },
};
