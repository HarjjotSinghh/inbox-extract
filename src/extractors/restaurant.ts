import * as ids from '../parse/ids.ts';
import { dateFromLabel } from '../parse/locate.ts';
import { cleanTitle, first, labelValue, mapFound } from '../parse/text.ts';
import { SCHEMA } from '../schema.ts';
import { Draft, type Extractor, type ExtractorContext } from './base.ts';

const REQUIRED = ['bookingId', 'restaurant', 'dateTime', 'partySize'] as const;

export const restaurant: Extractor = {
  category: 'restaurant',
  schemaType: SCHEMA.foodEstablishmentReservation,
  required: REQUIRED,
  strongAnchor: [['bookingId']],
  softAnchor: [['bookingId'], ['restaurant', 'dateTime', 'partySize']],

  run({ doc }: ExtractorContext) {
    const d = new Draft();

    d.set('bookingId', first(ids.bookingId(doc), ids.confirmationId(doc)));
    d.set('restaurant', mapFound(
      labelValue(doc, 'restaurant.name', ['Restaurant', 'Restaurant name', 'Venue']),
      'clean', cleanTitle,
    ));
    d.set('location', mapFound(
      labelValue(doc, 'restaurant.location', ['Location', 'Address']),
      'clean', cleanTitle,
    ));

    const when = dateFromLabel(doc, 'restaurant.dateTime', ['Date & time', 'Date and time', 'Reservation date & time', 'Booked for', 'Date/time']);
    if (when) {
      d.derive('dateTime', when.value.value, when, 'restaurant.dateTime');
      if (when.value.kind === 'date') d.markPartial('dateTime', 'Date found but no reservation time stated.');
      if (when.value.ambiguous) d.warn('Numeric date could be read day-first or month-first; day-first assumed.');
    }

    const partySpan = labelValue(doc, 'restaurant.partySize', ['Party size', 'No. of guests', 'Guests', 'Covers', 'Pax']);
    if (partySpan) {
      const m = /\d+/.exec(partySpan.value);
      if (m) d.derive('partySize', Number(m[0]), partySpan, 'restaurant.partySize');
    }

    d.set('table', mapFound(
      labelValue(doc, 'restaurant.table', ['Table', 'Table number', 'Table no']),
      'clean', cleanTitle,
    ));

    return d.finish({ required: REQUIRED });
  },
};
