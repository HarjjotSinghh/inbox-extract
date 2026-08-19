import * as ids from '../parse/ids.ts';
import { dateFromLabel, moneyFromLabel } from '../parse/locate.ts';
import { cleanTitle, first, labelValue, mapFound } from '../parse/text.ts';
import { SCHEMA } from '../schema.ts';
import { Draft, senderBrand, type Extractor, type ExtractorContext } from './base.ts';

const REQUIRED = ['reservationId', 'eventName', 'location', 'startDateTime', 'seats', 'amount'] as const;

export const event: Extractor = {
  category: 'event',
  schemaType: SCHEMA.eventReservation,
  required: REQUIRED,
  strongAnchor: [['reservationId']],
  softAnchor: [['reservationId'], ['eventName', 'startDateTime', 'location']],

  run({ doc }: ExtractorContext) {
    const d = new Draft();

    d.set('reservationId', first(ids.bookingId(doc), ids.confirmationId(doc)));

    d.set('eventName', first(
      mapFound(labelValue(doc, 'event.name', ['Movie', 'Event', 'Show', 'Play', 'Match', 'Concert', 'Film', 'Event name']), 'clean', cleanTitle),
    ));

    // Kept as the email wrote it. Splitting "PVR Forum Mall, Bengaluru" into a
    // structured Place would mean deciding which comma-part is the city — an
    // inference the email does not license.
    d.set('location', first(
      mapFound(labelValue(doc, 'event.location', ['Cinema', 'Venue', 'Theatre', 'Theater', 'Location', 'Hall', 'Stadium', 'Auditorium', 'Address']), 'clean', cleanTitle),
    ));

    const when = dateFromLabel(doc, 'event.when', [
      'Date & time', 'Date and time', 'Show time', 'Showtime', 'Date/time', 'Date', 'When', 'Starts',
    ], { notPartOf: ['Booking date', 'Booked on', 'Purchase date', 'Order date'] });
    if (when) {
      d.derive('startDateTime', when.value.value, when, 'event.startDateTime');
      if (when.value.kind === 'date') d.markPartial('startDateTime', 'Date found but no show time stated.');
      if (when.value.ambiguous) d.warn('Numeric date could be read day-first or month-first; day-first assumed.');
    }

    const seatSpan = labelValue(doc, 'event.seats', ['Seats', 'Seat numbers', 'Seat nos', 'Seat', 'Seat(s)']);
    if (seatSpan) {
      const seats = seatSpan.value
        .split(/\s*[,/&]\s*|\s+and\s+/i)
        .map((s) => cleanTitle(s))
        .filter((s) => s.length > 0 && s.length <= 12);
      if (seats.length) d.derive('seats', seats, seatSpan, 'event.seats');
    }

    d.set('amount', first(
      moneyFromLabel(doc, 'event.amount', ['Amount paid', 'Total amount', 'Total paid', 'Ticket price', 'Grand total', 'Total', 'Amount']),
    ));

    d.set('screen', doc.match('event.screen', /\bscreen\s+(\d+[A-Z]?)\b/i));
    d.set('provider', senderBrand(doc, 'event.provider.sender'));

    return d.finish({ required: REQUIRED });
  },
};
