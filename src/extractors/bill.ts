import * as ids from '../parse/ids.ts';
import { dateFromLabel, dateFromPattern, moneyFromLabel, moneyFromPattern } from '../parse/locate.ts';
import { cleanTitle, first, labelValue, mapFound } from '../parse/text.ts';
import { PAYMENT_STATUS, SCHEMA } from '../schema.ts';
import { billStatus, paymentStatusUrl } from '../status.ts';
import { Draft, senderBrand, type Extractor, type ExtractorContext } from './base.ts';

const REQUIRED = ['biller', 'account', 'amount', 'dueDate', 'status'] as const;

/**
 * One extractor for bills / bills-due / bills-overdue.
 *
 * They are the same email; only the relationship between the due date and today
 * differs, so status is computed once here instead of being three categories.
 */
export const bill: Extractor = {
  category: 'bill',
  schemaType: SCHEMA.invoice,
  required: REQUIRED,
  strongAnchor: [['amount', 'dueDate', 'account']],
  softAnchor: [['amount', 'dueDate'], ['amount', 'account']],

  run({ doc, today, dueSoonDays }: ExtractorContext) {
    const d = new Draft();

    d.set('biller', first(
      senderBrand(doc, 'bill.biller.sender'),
      mapFound(labelValue(doc, 'bill.biller', ['Biller', 'Provider', 'Operator']), 'clean', cleanTitle),
    ));
    d.set('account', ids.accountNumber(doc));

    d.set('amount', first(
      moneyFromLabel(doc, 'bill.amount', ['Bill amount', 'Amount payable', 'Total amount', 'Amount due', 'Amount', 'Total']),
      moneyFromPattern(doc, 'bill.amount.of', /\bbill\s+of\s+([^.\n]{1,30})/i),
      moneyFromPattern(doc, 'bill.amount.remit', /\b(?:kindly\s+)?remit\s+([^.\n]{1,30})/i),
    ));

    const due = first(
      dateFromLabel(doc, 'bill.dueDate', ['Due date', 'Payment due date', 'Payable by', 'Pay by', 'Last date of payment']),
      dateFromPattern(doc, 'bill.dueDate.was', /\b(?:was|is|were)\s+due\s+(?:on|by)\s+([^.,\n]{4,30})/i),
      dateFromPattern(doc, 'bill.dueDate.by', /\bdue\s+(?:on|by)\s+([^.,\n]{4,30})/i),
      dateFromPattern(doc, 'bill.dueDate.before', /\b(?:on\s+or\s+before|pay\s+by)\s+([^.,\n]{4,30})/i),
    );
    if (due) {
      d.derive('dueDate', due.value.value, due, 'bill.dueDate');
      if (due.value.ambiguous) d.warn('Numeric date could be read day-first or month-first; day-first assumed.');

      // An email confirming payment must not be scored against its due date;
      // the arithmetic would call every paid bill overdue.
      const paid = doc.match(
        'bill.paid',
        /\b(payment\s+received|we\s+have\s+received\s+your\s+payment|thank\s+you\s+for\s+your\s+payment|successfully\s+paid|payment\s+successful)\b/i,
      );
      if (paid) {
        d.derive('status', 'paid', paid, 'bill.status.paid');
        d.derive('paymentStatus', PAYMENT_STATUS.complete, paid, 'bill.paymentStatus');
      }

      const status = paid ? null : billStatus(due.value.value, today, dueSoonDays);
      if (status) {
        d.derive('status', status, due, `bill.status(today=${today},dueSoonDays=${dueSoonDays})`);
        d.derive('paymentStatus', paymentStatusUrl(status), due, 'bill.paymentStatus');

        // If the email says "overdue" and the arithmetic disagrees, surface it
        // rather than silently trusting either side.
        const saysOverdue = doc.has(/\b(?:overdue|past\s+due|payment\s+pending)\b/i);
        if (saysOverdue && status !== 'overdue') {
          d.warn(`Email states the bill is overdue, but the due date ${due.value.value} is not before ${today}.`);
        }
      } else if (!paid) {
        d.warn('Due date found but no reference date supplied, so status could not be computed.');
      }
    }

    d.set('lateFee', moneyFromPattern(doc, 'bill.lateFee', /\blate\s+(?:fee|charge|payment\s+charge)\s+of\s+([^.\n]{1,20})/i));
    d.set('unitsConsumed', mapFound(labelValue(doc, 'bill.units', ['Units consumed', 'Consumption', 'Usage']), 'clean', cleanTitle));
    d.set('billingPeriod', mapFound(labelValue(doc, 'bill.period', ['Billing period', 'Bill period', 'Billing cycle']), 'clean', cleanTitle));

    return d.finish({ required: REQUIRED });
  },
};
