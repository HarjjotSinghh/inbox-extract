import * as ids from '../parse/ids.ts';
import { dateFromLabel, dateFromPattern, moneyFromLabel } from '../parse/locate.ts';
import { cleanTitle, first, labelValue, mapFound } from '../parse/text.ts';
import { SCHEMA } from '../schema.ts';
import { Draft, senderBrand, type Extractor, type ExtractorContext } from './base.ts';

const REQUIRED = ['pnr', 'trainNumber', 'departureStation', 'arrivalStation', 'departureTime'] as const;

export const train: Extractor = {
  category: 'train',
  schemaType: SCHEMA.trainReservation,
  required: REQUIRED,
  strongAnchor: [['pnr', 'trainNumber']],
  softAnchor: [['pnr'], ['trainNumber', 'departureStation', 'arrivalStation']],

  run({ doc }: ExtractorContext) {
    const d = new Draft();

    d.set('pnr', ids.pnr(doc));
    d.set('operator', first(
      senderBrand(doc, 'train.operator.sender'),
      doc.match('train.operator.irctc', /\b(IRCTC)\b/),
    ));

    d.set('trainNumber', ids.trainNumber(doc));

    d.set('trainName', mapFound(
      // "Train: 12658 KSR Bengaluru Express" and "12658 - KSR Bengaluru
      // Express" both lead with the number; it is stripped off here so
      // `trainName` does not just repeat `trainNumber`.
      doc.match('train.name.suffixed', /\b\d{4,5}\s*(?:[-–—]\s*)?([A-Z][A-Za-z .'-]{2,40}?\s+(?:Express|Mail|Superfast|Duronto|Shatabdi|Rajdhani))\b/i),
      'clean', cleanTitle,
    ));

    d.set('departureStation', mapFound(
      labelValue(doc, 'train.from', ['From', 'Boarding station', 'Source station', 'Departure station']),
      'clean', cleanTitle,
    ));
    d.set('arrivalStation', mapFound(
      labelValue(doc, 'train.to', ['To', 'Destination station', 'Arrival station']),
      'clean', cleanTitle,
    ));

    const when = first(
      dateFromLabel(doc, 'train.date', ['Date of journey', 'Journey date', 'Travel date']),
      dateFromPattern(doc, 'train.date.on', /\bon\s+((?:\w+,?\s*)?\d{1,2}\s+\w{3,9},?\s+\d{4})/i),
    );
    const depTime = dateFromLabel(doc, 'train.departTime', ['Departure time', 'Departs at', 'Departure']);
    const arrTime = dateFromLabel(doc, 'train.arriveTime', ['Arrival time', 'Arrives at', 'Arrival']);

    if (when && when.value.kind !== 'time') {
      const date = when.value.value.slice(0, 10);
      if (depTime?.value.kind === 'time') {
        d.derive('departureTime', `${date}T${depTime.value.value}`, depTime, 'train.departureTime');
      } else {
        d.derive('departureTime', date, when, 'train.departureDateOnly');
        d.markPartial('departureTime', 'Journey date found but no departure clock time stated.');
      }
      if (arrTime?.value.kind === 'time') {
        const depClock = depTime?.value.kind === 'time' ? depTime.value.value : null;
        if (depClock && arrTime.value.value >= depClock) {
          d.derive('arrivalTime', `${date}T${arrTime.value.value}`, arrTime, 'train.arrivalTime');
        } else {
          // Same-day arrival can only be asserted once departure's own clock
          // time is known and precedes it. An unknown departure time does not
          // imply same-day either — a departure late in the day could still
          // land the next morning, and stamping the journey date on the
          // arrival either way would fabricate a date the email never states.
          d.derive('arrivalTime', arrTime.value.value, arrTime, 'train.arrivalTimeOnly');
          d.markPartial('arrivalTime', depClock
            ? 'Arrival clock time precedes departure (overnight journey); the email does not state the arrival date.'
            : 'Arrival time found but no departure clock time stated, so whether it falls on the journey date or the next day cannot be determined.');
        }
      }
    } else if (depTime) {
      d.derive('departureTime', depTime.value.value, depTime, 'train.departureTime');
      if (depTime.value.kind === 'time') {
        d.markPartial('departureTime', 'Departure time found but no journey date stated.');
      }
    }

    d.set('classOfTravel', mapFound(
      labelValue(doc, 'train.class', ['Class', 'Class of travel', 'Coach class']),
      'clean', cleanTitle,
    ));
    d.set('coach', doc.match('train.coach', /\bcoach\s*[:#]?\s*([A-Z]{1,3}\d{0,2})\b/i));
    d.set('berth', doc.match('train.berth', /\bberth\s*(?:no\.?)?\s*[:#]?\s*(\d{1,3}\s*\/?\s*[A-Za-z]*(?:\s+(?:lower|upper|middle|side\s+lower|side\s+upper))?)\b/i));

    d.set('fare', moneyFromLabel(doc, 'train.fare', ['Total fare', 'Ticket fare', 'Fare', 'Total amount']));

    return d.finish({ required: REQUIRED });
  },
};
