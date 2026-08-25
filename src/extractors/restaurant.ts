import * as ids from '../parse/ids.ts';
import { dateFromLabel, dateFromPattern } from '../parse/locate.ts';
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
      first(
        labelValue(doc, 'restaurant.name.label', ['Restaurant', 'Restaurant name', 'Venue']),
        doc.match('restaurant.name.prose', /\b(?:reservation|table|booking)\s+at\s+([A-Z][\w&.,'-]*(?:\s+[\w&.,'-]+){0,4}?)(?=\s+(?:is|has|was)\b|[,.!]|$)/i),
      ),
      'clean', cleanTitle,
    ));
    d.set('location', mapFound(
      labelValue(doc, 'restaurant.location', ['Location', 'Address']),
      'clean', cleanTitle,
    ));

    const when = first(
      dateFromLabel(doc, 'restaurant.dateTime', ['Date & time', 'Date and time', 'Reservation date & time', 'Booked for', 'Date/time']),
      // "confirmed for 2 guests on 21 Sep 2026 at 19:00" — no label at all.
      dateFromPattern(doc, 'restaurant.dateTime.on', /\bon\s+(\d{1,2}\s+\w{3,9}\s+\d{4}\s+at\s+\d{1,2}:\d{2})/i),
    );
    if (when) {
      d.derive('dateTime', when.value.value, when, 'restaurant.dateTime');
      if (when.value.kind === 'date') d.markPartial('dateTime', 'Date found but no reservation time stated.');
      if (when.value.ambiguous) d.warn('Numeric date could be read day-first or month-first; day-first assumed.');
    }

    const partySpan = first(
      labelValue(doc, 'restaurant.partySize.label', ['Party size', 'No. of guests', 'Guests', 'Covers', 'Pax']),
      doc.match('restaurant.partySize.prose', /\bfor\s+(\d{1,2}\s+(?:guests?|people|persons?|pax))\b/i),
    );
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
