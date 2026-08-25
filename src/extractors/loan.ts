import * as ids from '../parse/ids.ts';
import { dateFromLabel, dateFromPattern, moneyFromLabel, moneyFromPattern } from '../parse/locate.ts';
import { cleanTitle, first, labelValue, mapFound } from '../parse/text.ts';
import { LOCAL } from '../schema.ts';
import { billStatus, paymentStatusUrl } from '../status.ts';
import { Draft, senderBrand, type Extractor, type ExtractorContext } from './base.ts';

const REQUIRED = ['lender', 'loanAccountId', 'emiAmount', 'dueDate'] as const;

export const loan: Extractor = {
  category: 'loan',
  schemaType: LOCAL.loanInstallment,
  required: REQUIRED,
  strongAnchor: [['loanAccountId', 'emiAmount']],
  softAnchor: [['loanAccountId'], ['emiAmount', 'dueDate']],

  run({ doc, today, dueSoonDays }: ExtractorContext) {
    const d = new Draft();

    d.set('lender', first(
      senderBrand(doc, 'loan.lender.sender'),
      mapFound(labelValue(doc, 'loan.lender', ['Lender', 'Bank', 'NBFC']), 'clean', cleanTitle),
    ));
    // "Loan Account Number" / "Loan A/c No" both satisfy the generic
    // account-number rule below — no loan-specific pattern needed.
    d.set('loanAccountId', ids.accountNumber(doc));

    d.set('emiAmount', first(
      moneyFromLabel(doc, 'loan.emiAmount', ['EMI amount', 'EMI due', 'Installment amount', 'Instalment amount']),
      // A blob-capture ([^.\n]{1,30}) fails here: "EMI of Rs. 12,300" has a
      // period inside "Rs." itself, so the class would stop before the digits.
      moneyFromPattern(doc, 'loan.emiAmount.of', /\bEMI\s+of\s+((?:₹|Rs\.?|INR|\$)\s*[\d,]+(?:\.\d{1,2})?)/i),
    ));

    const due = first(
      dateFromLabel(doc, 'loan.dueDate', ['Due date', 'EMI due date', 'Payment due date', 'Payable by']),
      // Generic "is/was due on|by" — not anchored to "EMI" immediately
      // preceding it, since the amount routinely sits in between.
      dateFromPattern(doc, 'loan.dueDate.was', /\b(?:is|was|were)\s+due\s+(?:on|by)\s+([^.,\n]{4,30})/i),
      dateFromPattern(doc, 'loan.dueDate.by', /\bdue\s+(?:on|by)\s+([^.,\n]{4,30})/i),
    );
    if (due) {
      d.derive('dueDate', due.value.value, due, 'loan.dueDate');
      if (due.value.ambiguous) d.warn('Numeric date could be read day-first or month-first; day-first assumed.');

      const status = billStatus(due.value.value, today, dueSoonDays);
      if (status) {
        d.derive('status', status, due, `loan.status(today=${today},dueSoonDays=${dueSoonDays})`);
        d.derive('paymentStatus', paymentStatusUrl(status), due, 'loan.paymentStatus');
      } else {
        d.warn('Due date found but no reference date supplied, so status could not be computed.');
      }
    }

    d.set('installmentNumber', mapFound(
      labelValue(doc, 'loan.installmentNumber', ['Installment no', 'Instalment no', 'EMI number', 'EMI no']),
      'clean', cleanTitle,
    ));
    d.set('outstanding', moneyFromLabel(doc, 'loan.outstanding', ['Outstanding amount', 'Outstanding balance', 'Outstanding principal', 'Outstanding']));

    return d.finish({ required: REQUIRED });
  },
};
