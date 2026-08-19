import * as ids from '../parse/ids.ts';
import { dateFromLabel } from '../parse/locate.ts';
import { cleanTitle, first, labelValue, mapFound, refine, sliceOf } from '../parse/text.ts';
import { SCHEMA } from '../schema.ts';
import { Draft, senderBrand, type Extractor, type ExtractorContext } from './base.ts';

const REQUIRED = ['provider', 'specialty', 'location', 'dateTime', 'appointmentId'] as const;

const SPECIALTY =
  /\b(dermatolog\w*|cardiolog\w*|dent(?:ist|al)\w*|orthop(?:a)?edic\w*|p(?:a)?ediatric\w*|gyn(?:a)?ecolog\w*|neurolog\w*|ophthalmolog\w*|psychiatr\w*|psycholog\w*|physiotherap\w*|radiolog\w*|oncolog\w*|urolog\w*|endocrinolog\w*|gastroenterolog\w*|pulmonolog\w*|nephrolog\w*|rheumatolog\w*|ENT|general\s+physician|general\s+practitioner)\b/i;

export const medical: Extractor = {
  category: 'medical',
  schemaType: SCHEMA.reservation,
  required: REQUIRED,

  run({ doc }: ExtractorContext) {
    const d = new Draft();

    const providerLabel = labelValue(doc, 'medical.provider', [
      'Doctor', 'Physician', 'Provider', 'Consultant', 'Specialist', 'Practitioner', 'With',
    ]);

    // "Dr. Anita Rao (Dermatologist)" carries two fields in one span.
    d.set('provider', first(
      refine(providerLabel, 'beforeParen', (s) => sliceOf(s, s.split('(')[0] ?? s)),
      mapFound(doc.match('medical.provider.drname', /\b(Dr\.?\s+[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})/), 'clean', cleanTitle),
    ));

    d.set('specialty', first(
      refine(providerLabel, 'insideParen', (s) => {
        const m = /\(([^)]{3,40})\)/.exec(s);
        return m?.[1] ? sliceOf(s, m[1]) : null;
      }),
      doc.match('medical.specialty.word', SPECIALTY),
      mapFound(labelValue(doc, 'medical.specialty', ['Specialty', 'Speciality', 'Department']), 'clean', cleanTitle),
    ));

    d.set('location', first(
      mapFound(labelValue(doc, 'medical.location', ['Clinic', 'Hospital', 'Location', 'Venue', 'Address', 'Centre', 'Center', 'Branch']), 'clean', cleanTitle),
    ));

    const when = first(
      dateFromLabel(doc, 'medical.when', ['Date & time', 'Date and time', 'Appointment date and time', 'Appointment date', 'Date/time', 'When', 'Scheduled for', 'Date']),
    );
    if (when) {
      d.derive('dateTime', when.value.value, when, 'medical.dateTime');
      if (when.value.kind === 'date') {
        d.markPartial('dateTime', 'Appointment date found but no time of day stated.');
      }
      if (when.value.ambiguous) {
        d.warn('Numeric date could be read day-first or month-first; day-first assumed.');
      }
    }

    d.set('appointmentId', ids.appointmentId(doc));
    d.set('platform', senderBrand(doc, 'medical.platform.sender'));

    return d.finish({
      required: REQUIRED,
      anchorStrong: d.has('appointmentId'),
      anchorSatisfied: d.has('appointmentId') || (d.has('provider') && d.has('dateTime')),
    });
  },
};
