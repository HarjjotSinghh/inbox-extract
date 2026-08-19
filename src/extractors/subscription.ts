import * as ids from '../parse/ids.ts';
import { dateFromLabel, dateFromPattern, moneyFromLabel, moneyFromPattern } from '../parse/locate.ts';
import { cleanTitle, first, labelValue, mapFound } from '../parse/text.ts';
import { LOCAL } from '../schema.ts';
import { Draft, senderBrand, type Extractor, type ExtractorContext } from './base.ts';

const REQUIRED = ['service', 'plan', 'amount', 'renewalDate', 'status'] as const;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const subscription: Extractor = {
  category: 'subscription',
  schemaType: LOCAL.subscriptionRenewal,
  required: REQUIRED,
  strongAnchor: [['renewalDate', 'status']],
  softAnchor: [['service', 'renewalDate'], ['service', 'amount']],

  run({ doc }: ExtractorContext) {
    const d = new Draft();

    const service = d.set('service', first(
      senderBrand(doc, 'subscription.service.sender'),
      mapFound(labelValue(doc, 'subscription.service', ['Service', 'Subscription']), 'clean', cleanTitle),
    ));

    // "your Netflix Premium plan" names the service and the tier in one phrase.
    // Once the service is known we strip it, so the plan reads "Premium".
    const planWithService = service
      ? doc.match(
          'subscription.plan.tier',
          new RegExp(`\\b(?:your|the)\\s+${escapeRe(service)}\\s+([A-Za-z0-9+ ]{2,24}?)\\s+(?:plan|membership|subscription|tier|trial)\\b`, 'i'),
        )
      : null;
    d.set('plan', first(
      mapFound(planWithService, 'clean', cleanTitle),
      mapFound(labelValue(doc, 'subscription.plan', ['Plan', 'Plan name', 'Membership', 'Tier']), 'clean', cleanTitle),
      mapFound(doc.match('subscription.plan.generic', /\b(?:your|the)\s+([A-Za-z0-9+ ]{2,30}?)\s+(?:plan|membership)\b/i), 'clean', cleanTitle),
    ));

    d.set('amount', first(
      moneyFromPattern(doc, 'subscription.amount.charged', /\b(?:be\s+)?charged\s+([^.\n]{1,30})/i),
      moneyFromLabel(doc, 'subscription.amount', ['Amount', 'Price', 'Charge', 'Renewal amount', 'Total']),
    ));

    const renewal = first(
      dateFromPattern(doc, 'subscription.renewal.on', /\b(?:will\s+)?renews?\s+on\s+([^.\n]{4,40})/i),
      dateFromPattern(doc, 'subscription.trial.on', /\btrial\s+(?:ends|will\s+end|expires)\s+on\s+([^.\n]{4,40})/i),
      dateFromLabel(doc, 'subscription.renewal', ['Renewal date', 'Next billing date', 'Next payment date', 'Renews on', 'Trial ends', 'Expires on']),
    );
    if (renewal) {
      d.derive('renewalDate', renewal.value.value, renewal, 'subscription.renewalDate');
      if (renewal.value.ambiguous) d.warn('Numeric date could be read day-first or month-first; day-first assumed.');
    }

    // A trial ending and a paid renewal produce different user actions, so the
    // distinction is read from the email rather than defaulted.
    const trial = doc.match('subscription.status.trial', /\b(trial\s+(?:ends|ending|will\s+end|expires|is\s+ending)|free\s+trial)\b/i);
    const renewing = doc.match('subscription.status.renewing', /\b((?:will\s+)?renews?(?:\s+on)?|auto-?renew\w*|membership\s+will\s+renew)\b/i);
    if (trial) d.derive('status', 'trial-ending', trial, 'subscription.status');
    else if (renewing) d.derive('status', 'renewing', renewing, 'subscription.status');

    d.set('paymentMethodLast4', ids.cardLast4(doc));

    return d.finish({ required: REQUIRED });
  },
};
