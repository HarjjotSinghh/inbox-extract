import * as ids from '../parse/ids.ts';
import { dateFromLabel, moneyFromLabel } from '../parse/locate.ts';
import { cleanTitle, first, labelValue, mapFound } from '../parse/text.ts';
import { SCHEMA } from '../schema.ts';
import { Draft, senderBrand, type Extractor, type ExtractorContext } from './base.ts';

const REQUIRED = ['bookingId', 'provider', 'pickup', 'drop'] as const;

export const cab: Extractor = {
  category: 'cab',
  schemaType: SCHEMA.rentalCarReservation,
  required: REQUIRED,
  strongAnchor: [['bookingId']],
  softAnchor: [['bookingId'], ['provider', 'pickup', 'drop']],

  run({ doc }: ExtractorContext) {
    const d = new Draft();

    d.set('bookingId', ids.bookingId(doc));
    d.set('provider', senderBrand(doc, 'cab.provider.sender'));

    d.set('pickup', mapFound(
      labelValue(doc, 'cab.pickup', ['Pickup location', 'Pickup point', 'Pickup', 'From']),
      'clean', cleanTitle,
    ));
    d.set('drop', mapFound(
      labelValue(doc, 'cab.drop', ['Drop location', 'Drop point', 'Drop-off', 'Drop', 'To']),
      'clean', cleanTitle,
    ));

    const when = dateFromLabel(doc, 'cab.when', ['Pickup date & time', 'Pickup time', 'Scheduled at', 'Trip date']);
    if (when) {
      d.derive('pickupTime', when.value.value, when, 'cab.pickupTime');
      if (when.value.kind === 'time') d.markPartial('pickupTime', 'Pickup time found but no date stated.');
      if (when.value.ambiguous) d.warn('Numeric date could be read day-first or month-first; day-first assumed.');
    }

    d.set('vehicle', mapFound(
      labelValue(doc, 'cab.vehicle', ['Vehicle', 'Car type', 'Cab type']),
      'clean', cleanTitle,
    ));
    d.set('fare', first(
      moneyFromLabel(doc, 'cab.fare', ['Trip fare', 'Estimated fare', 'Fare estimate', 'Total fare', 'Fare']),
    ));

    return d.finish({ required: REQUIRED });
  },
};
