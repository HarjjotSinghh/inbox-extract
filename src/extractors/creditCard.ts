import * as ids from '../parse/ids.ts';
import { dateFromLabel, moneyFromLabel } from '../parse/locate.ts';
import { cleanTitle, first, labelValue, mapFound } from '../parse/text.ts';
import { SCHEMA } from '../schema.ts';
import { billStatus, paymentStatusUrl } from '../status.ts';
import { Draft, senderBrand, type Extractor, type ExtractorContext } from './base.ts';

const REQUIRED = ['issuer', 'cardLast4', 'statementDate', 'dueDate', 'totalDue', 'minDue', 'status'] as const;

/**
 * A card statement is a richer bill, so it shares the computed status vocabulary
 * (upcoming / due-soon / overdue) and maps to schema.org Invoice, whose
 * `minimumPaymentDue` / `totalPaymentDue` / `paymentDueDate` properties fit exactly.
 */
export const creditCard: Extractor = {
  category: 'credit-card',
  schemaType: SCHEMA.invoice,
  required: REQUIRED,

  run({ doc, today, dueSoonDays }: ExtractorContext) {
    const d = new Draft();

    d.set('issuer', first(
      senderBrand(doc, 'card.issuer.sender'),
      mapFound(labelValue(doc, 'card.issuer', ['Issuer', 'Bank']), 'clean', cleanTitle),
    ));
    d.set('cardLast4', ids.cardLast4(doc));

    const stmt = dateFromLabel(doc, 'card.statementDate', ['Statement date', 'Statement generated on', 'Bill date', 'Statement period end']);
    if (stmt) d.derive('statementDate', stmt.value.value, stmt, 'card.statementDate');

    const due = dateFromLabel(doc, 'card.dueDate', ['Payment due date', 'Due date', 'Payment due by', 'Pay by', 'Payment due']);
    if (due) d.derive('dueDate', due.value.value, due, 'card.dueDate');

    d.set('totalDue', moneyFromLabel(doc, 'card.totalDue', ['Total amount due', 'Total payment due', 'Total due', 'Amount due', 'Statement balance']));
    d.set('minDue', moneyFromLabel(doc, 'card.minDue', ['Minimum amount due', 'Minimum payment due', 'Min amount due', 'Minimum due', 'Min due']));
    d.set('availableCredit', moneyFromLabel(doc, 'card.availableCredit', ['Available credit limit', 'Available credit', 'Available limit']));
    d.set('creditLimit', moneyFromLabel(doc, 'card.creditLimit', ['Total credit limit', 'Credit limit'], {
      notPartOf: ['Available credit limit', 'Available credit'],
    }));

    if (due) {
      const status = billStatus(due.value.value, today, dueSoonDays);
      if (status) {
        d.derive('status', status, due, `card.status(today=${today},dueSoonDays=${dueSoonDays})`);
        d.derive('paymentStatus', paymentStatusUrl(status), due, 'card.paymentStatus');
      } else {
        d.warn('Due date found but no reference date supplied, so status could not be computed.');
      }
    }

    return d.finish({
      required: REQUIRED,
      // A card last-4 tied to statement figures is the thing a marketing blast
      // about the same card never has.
      anchorStrong: d.has('cardLast4') && (d.has('totalDue') || d.has('statementDate') || d.has('minDue')),
      anchorSatisfied: d.has('cardLast4') && (d.has('totalDue') || d.has('dueDate') || d.has('statementDate')),
    });
  },
};
