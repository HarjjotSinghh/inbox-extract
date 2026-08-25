import * as ids from '../parse/ids.ts';
import { dateFromLabel, moneyFromLabel } from '../parse/locate.ts';
import { cleanTitle, first, labelValue, mapFound } from '../parse/text.ts';
import { LOCAL } from '../schema.ts';
import { Draft, senderBrand, type Extractor, type ExtractorContext } from './base.ts';

const REQUIRED = ['insurer', 'policyNumber', 'premium', 'renewalDate'] as const;

const POLICY_TYPE = /\b(health|term|motor|car|two-?wheeler|life|home|travel)\s+insurance\b/i;

export const insurance: Extractor = {
  category: 'insurance',
  schemaType: LOCAL.insurancePolicy,
  required: REQUIRED,
  strongAnchor: [['policyNumber']],
  softAnchor: [['policyNumber'], ['insurer', 'premium']],

  run({ doc }: ExtractorContext) {
    const d = new Draft();

    // A stated "Insurer:" outranks the sender: aggregators (Policybazaar)
    // send on the insurer's behalf, so senderBrand alone would name the
    // aggregator whenever both are present.
    d.set('insurer', first(
      mapFound(labelValue(doc, 'insurance.insurer', ['Insurer', 'Insurance company']), 'clean', cleanTitle),
      senderBrand(doc, 'insurance.insurer.sender'),
    ));
    d.set('policyNumber', ids.policyNumber(doc));

    // The word-list match is normalised to lowercase (it names one of a fixed
    // set: health/term/motor/...); a "Policy type:" label keeps its own
    // casing, since it may state something outside that set.
    d.set('policyType', first(
      mapFound(labelValue(doc, 'insurance.policyType.label', ['Policy type', 'Plan type']), 'clean', cleanTitle),
      mapFound(doc.match('insurance.policyType', POLICY_TYPE, 1), 'lower', (s) => s.toLowerCase()),
    ));

    d.set('premium', moneyFromLabel(doc, 'insurance.premium', ['Premium amount', 'Premium due', 'Premium', 'Amount due']));

    const renewal = dateFromLabel(doc, 'insurance.renewalDate', ['Renewal date', 'Due date', 'Policy expiry date', 'Expiry date', 'Valid till']);
    if (renewal) {
      d.derive('renewalDate', renewal.value.value, renewal, 'insurance.renewalDate');
      if (renewal.value.ambiguous) d.warn('Numeric date could be read day-first or month-first; day-first assumed.');
    }

    d.set('sumInsured', moneyFromLabel(doc, 'insurance.sumInsured', ['Sum insured', 'Sum assured', 'Coverage amount']));

    return d.finish({ required: REQUIRED });
  },
};
