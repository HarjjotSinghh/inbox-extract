import { daysBetween } from './parse/datetime.ts';
import { PAYMENT_STATUS } from './schema.ts';
import type { BillStatus } from './types.ts';

/**
 * Bills, bill-due and bill-overdue are one kind of email sorted by its due date,
 * so status is computed rather than read.
 *
 * The 'due-soon' window is a product choice, not something the email states —
 * hence configurable, defaulted to 3 days, and recorded in DECISIONS.md.
 */
export const DEFAULT_DUE_SOON_DAYS = 3;

export function billStatus(
  dueDate: string,
  today: string | null,
  dueSoonDays: number = DEFAULT_DUE_SOON_DAYS,
): BillStatus | null {
  if (!today) return null;
  const days = daysBetween(today, dueDate);
  if (days == null) return null;
  if (days < 0) return 'overdue';
  if (days <= dueSoonDays) return 'due-soon';
  return 'upcoming';
}

export function paymentStatusUrl(status: BillStatus): string {
  return status === 'overdue' ? PAYMENT_STATUS.pastDue : PAYMENT_STATUS.due;
}
