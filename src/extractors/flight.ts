import { combine } from '../parse/datetime.ts';
import * as ids from '../parse/ids.ts';
import { dateFromLabel, dateFromPattern } from '../parse/locate.ts';
import { first, spanUnion } from '../parse/text.ts';
import { SCHEMA } from '../schema.ts';
import { Draft, senderBrand, type Extractor, type ExtractorContext } from './base.ts';

const REQUIRED = ['reservationId', 'flightNumber', 'departureAirport', 'arrivalAirport', 'departureTime'] as const;

/** "AI-302" and "AI302" both denote AI 302; IATA writes it with a space. */
function normaliseFlightNumber(raw: string): string {
  const m = /^([A-Z0-9]{2})[\s-]?(\d{1,4})$/i.exec(raw.trim());
  return m ? `${(m[1] ?? '').toUpperCase()} ${m[2]}` : raw.trim().toUpperCase();
}

export const flight: Extractor = {
  category: 'flight',
  schemaType: SCHEMA.flightReservation,
  required: REQUIRED,

  run({ doc }: ExtractorContext) {
    const d = new Draft();

    d.set('reservationId', ids.pnr(doc));
    d.set('airline', first(
      senderBrand(doc, 'flight.airline.sender'),
      doc.match('flight.airline.body', /\bairline\s*[:#]\s*([A-Za-z .'-]{3,30})/i),
    ));

    const fn = ids.flightNumber(doc);
    if (fn) d.derive('flightNumber', normaliseFlightNumber(fn.value), fn, 'flight.normaliseNumber');

    const { from, to } = ids.airports(doc);
    d.set('departureAirport', from);
    d.set('arrivalAirport', to);

    // Date of travel, then the two clock times stated separately alongside it.
    const dateHit = first(
      dateFromLabel(doc, 'flight.date', ['Date of journey', 'Travel date', 'Journey date']),
      dateFromPattern(doc, 'flight.date.departs', /(\d{1,2}\s+\w{3,9},?\s+\d{4}),?\s+(?:departs?|departure)/i),
      // "on 12 Sep 2026, departs" — but not "Booked on 01 Sep 2026".
      dateFromPattern(doc, 'flight.date.on', /(?<!\bbooked\s)\bon\s+((?:\w+,?\s*)?\d{1,2}\s+\w{3,9},?\s+\d{4})/i),
    );
    const travelDate = dateHit && dateHit.value.kind !== 'time' ? dateHit.value.value.slice(0, 10) : null;

    const dep = dateFromPattern(doc, 'flight.depart', /\b(?:departs?|departure|dep)\b[^\d]{0,12}(\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?)/i);
    const arr = dateFromPattern(doc, 'flight.arrive', /\b(?:arrives?|arrival|arr)\b[^\d]{0,12}(\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?)/i);

    if (dateHit?.value.kind === 'datetime') {
      d.derive('departureTime', dateHit.value.value, dateHit, 'flight.departureTime');
    } else if (travelDate && dep?.value.kind === 'time') {
      // The value is composed from the travel date and the departure clock
      // time, so the quote must cover both, not just the time.
      const union = spanUnion(doc.text, dateHit, dep);
      d.derive(
        'departureTime',
        combine(travelDate, dep.value.value),
        union ? { ...dep, ...union } : dep,
        'flight.departureTime',
      );
    } else if (travelDate) {
      d.derive('departureTime', travelDate, dateHit, 'flight.departureDateOnly');
      d.markPartial('departureTime', 'Departure date found but no departure clock time stated.');
    }

    if (travelDate && arr?.value.kind === 'time') {
      const depTime = dep?.value.kind === 'time' ? dep.value.value : null;
      if (!depTime || arr.value.value >= depTime) {
        const union = spanUnion(doc.text, dateHit, arr);
        d.derive(
          'arrivalTime',
          combine(travelDate, arr.value.value),
          union ? { ...arr, ...union } : arr,
          'flight.arrivalTime',
        );
      } else {
        // Arrival earlier than departure means an overnight leg. The email does
        // not say which date it lands on, so we refuse to add a day.
        d.derive('arrivalTime', arr.value.value, arr, 'flight.arrivalTimeOnly');
        d.markPartial('arrivalTime', 'Arrival clock time precedes departure (overnight leg); the email does not state the arrival date.');
      }
    }

    d.set('seat', doc.match('flight.seat', /\bseats?\s*(?:no\.?|number)?\s*[:#]?\s*(\d{1,3}[A-Z])\b/i));

    return d.finish({
      required: REQUIRED,
      // A flight number in "book 6E 202 this weekend" is not a booking.
      // The PNR is the thing marketing does not have.
      anchorStrong: d.has('reservationId'),
      anchorSatisfied: d.has('reservationId') || d.has('flightNumber'),
    });
  },
};
