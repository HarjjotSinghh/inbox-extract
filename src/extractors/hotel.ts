import { daysBetween } from '../parse/datetime.ts';
import * as ids from '../parse/ids.ts';
import { dateFromLabel, moneyFromLabel } from '../parse/locate.ts';
import { cleanTitle, first, labelValue, mapFound, spanUnion } from '../parse/text.ts';
import { SCHEMA } from '../schema.ts';
import { Draft, type Extractor, type ExtractorContext } from './base.ts';

const REQUIRED = ['bookingId', 'hotel', 'checkIn', 'checkOut'] as const;

export const hotel: Extractor = {
  category: 'hotel',
  schemaType: SCHEMA.lodgingReservation,
  required: REQUIRED,
  strongAnchor: [['bookingId']],
  softAnchor: [['bookingId'], ['hotel', 'checkIn', 'checkOut']],

  run({ doc }: ExtractorContext) {
    const d = new Draft();

    d.set('bookingId', ids.bookingId(doc));
    d.set('hotel', mapFound(
      labelValue(doc, 'hotel.name', ['Hotel', 'Hotel name', 'Property', 'Property name']),
      'clean', cleanTitle,
    ));
    d.set('location', mapFound(
      labelValue(doc, 'hotel.location', ['Location', 'Address', 'City']),
      'clean', cleanTitle,
    ));

    const checkIn = dateFromLabel(doc, 'hotel.checkIn', ['Check-in', 'Check in', 'Check-in date']);
    const checkOut = dateFromLabel(doc, 'hotel.checkOut', ['Check-out', 'Check out', 'Check-out date']);
    if (checkIn) {
      d.derive('checkIn', checkIn.value.value, checkIn, 'hotel.checkIn');
      if (checkIn.value.ambiguous) d.warn('Numeric date could be read day-first or month-first; day-first assumed.');
    }
    if (checkOut) {
      d.derive('checkOut', checkOut.value.value, checkOut, 'hotel.checkOut');
      if (checkOut.value.ambiguous) d.warn('Numeric date could be read day-first or month-first; day-first assumed.');
    }
    if (checkIn && checkOut) {
      const nights = daysBetween(checkIn.value.value, checkOut.value.value);
      if (nights != null && nights > 0) {
        const union = spanUnion(doc.text, checkIn, checkOut);
        d.derive('nights', nights, union ? { ...checkIn, ...union } : checkIn, 'hotel.nights');
      }
    }

    d.set('roomType', mapFound(
      labelValue(doc, 'hotel.roomType', ['Room type', 'Room category', 'Room']),
      'clean', cleanTitle,
    ));
    d.set('guests', mapFound(
      labelValue(doc, 'hotel.guests', ['Guests', 'No. of guests', 'Occupancy']),
      'clean', cleanTitle,
    ));
    d.set('total', first(
      moneyFromLabel(doc, 'hotel.total', ['Total amount', 'Total price', 'Amount paid', 'Grand total', 'Total']),
    ));

    return d.finish({ required: REQUIRED });
  },
};
