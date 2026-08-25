import * as ids from '../parse/ids.ts';
import { dateFromLabel, moneyFromLabel } from '../parse/locate.ts';
import { cleanTitle, first, labelValue, mapFound } from '../parse/text.ts';
import { LOCAL } from '../schema.ts';
import { Draft, senderBrand, type Extractor, type ExtractorContext } from './base.ts';

const REQUIRED = ['employer', 'payPeriod', 'netPay'] as const;

export const salary: Extractor = {
  category: 'salary',
  schemaType: LOCAL.payslip,
  required: REQUIRED,
  sensitive: true,
  strongAnchor: [['payslipId']],
  softAnchor: [['payslipId'], ['employer', 'payPeriod', 'netPay']],

  run({ doc }: ExtractorContext) {
    const d = new Draft();

    // A stated "Employer:" outranks the sender: payroll platforms (Keka, Zoho
    // Payroll) send on the employer's behalf, so the sender brand would be
    // the platform, not the employer, whenever both are present.
    d.set('employer', first(
      mapFound(labelValue(doc, 'salary.employer', ['Employer', 'Company']), 'clean', cleanTitle),
      senderBrand(doc, 'salary.employer.sender'),
    ));
    d.set('payPeriod', mapFound(
      labelValue(doc, 'salary.payPeriod', ['Pay period', 'Salary period', 'For the month of', 'Month']),
      'clean', cleanTitle,
    ));

    d.set('netPay', moneyFromLabel(doc, 'salary.netPay', ['Net pay', 'Net salary', 'Take-home pay', 'Take home']));
    d.set('grossPay', moneyFromLabel(doc, 'salary.grossPay', ['Gross pay', 'Gross salary', 'Gross earnings']));
    d.set('deductions', moneyFromLabel(doc, 'salary.deductions', ['Total deductions', 'Deductions']));

    const credit = dateFromLabel(doc, 'salary.creditDate', ['Credited on', 'Credit date', 'Payment date', 'Salary credited on']);
    if (credit) d.derive('creditDate', credit.value.value, credit, 'salary.creditDate');

    d.set('payslipId', ids.payslipId(doc));

    return d.finish({ required: REQUIRED });
  },
};
