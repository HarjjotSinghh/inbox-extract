import * as ids from '../parse/ids.ts';
import { dateFromLabel, moneyFromLabel } from '../parse/locate.ts';
import { cleanTitle, first, labelValue, mapFound } from '../parse/text.ts';
import { SCHEMA } from '../schema.ts';
import { Draft, senderBrand, type Extractor, type ExtractorContext } from './base.ts';

const REQUIRED = ['bookingId', 'operator', 'from', 'to', 'departureTime'] as const;

export const bus: Extractor = {
  category: 'bus',
  schemaType: SCHEMA.busReservation,
  required: REQUIRED,
  strongAnchor: [['bookingId']],
  softAnchor: [['bookingId'], ['operator', 'from', 'to']],

  run({ doc }: ExtractorContext) {
    const d = new Draft();

    d.set('bookingId', ids.bookingId(doc));
    d.set('operator', first(
      mapFound(labelValue(doc, 'bus.operator', ['Operator', 'Bus operator', 'Travels']), 'clean', cleanTitle),
      senderBrand(doc, 'bus.operator.sender'),
    ));

    d.set('from', mapFound(labelValue(doc, 'bus.from', ['From', 'Boarding city', 'Source']), 'clean', cleanTitle));
    d.set('to', mapFound(labelValue(doc, 'bus.to', ['To', 'Destination city', 'Destination']), 'clean', cleanTitle));

    const depart = dateFromLabel(doc, 'bus.departureTime', ['Departure', 'Departure date & time', 'Boarding time', 'Departs at']);
    if (depart) {
      d.derive('departureTime', depart.value.value, depart, 'bus.departureTime');
      if (depart.value.kind === 'time') d.markPartial('departureTime', 'Departure time found but no travel date stated.');
      if (depart.value.ambiguous) d.warn('Numeric date could be read day-first or month-first; day-first assumed.');
    }
    const arrive = dateFromLabel(doc, 'bus.arrivalTime', ['Arrival', 'Arrival date & time', 'Arrives at']);
    if (arrive) {
      d.derive('arrivalTime', arrive.value.value, arrive, 'bus.arrivalTime');
      if (arrive.value.kind === 'time') d.markPartial('arrivalTime', 'Arrival time found but no date stated.');
      if (arrive.value.ambiguous) d.warn('Numeric date could be read day-first or month-first; day-first assumed.');
    }

    const seatSpan = labelValue(doc, 'bus.seats', ['Seat numbers', 'Seat no', 'Seats', 'Seat']);
    if (seatSpan) {
      const seats = seatSpan.value.split(/\s*[,/&]\s*|\s+and\s+/i).map((s) => cleanTitle(s)).filter(Boolean);
      if (seats.length) d.derive('seats', seats, seatSpan, 'bus.seats');
    }

    d.set('boardingPoint', mapFound(labelValue(doc, 'bus.boardingPoint', ['Boarding point', 'Pickup point']), 'clean', cleanTitle));
    d.set('fare', moneyFromLabel(doc, 'bus.fare', ['Total fare', 'Ticket fare', 'Fare', 'Total amount', 'Amount paid']));

    return d.finish({ required: REQUIRED });
  },
};
