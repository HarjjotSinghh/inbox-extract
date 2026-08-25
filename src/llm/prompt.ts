import { EXTRACTORS } from '../extractors/registry.ts';
import type { Doc } from '../normalize.ts';
import type { Category } from '../types.ts';

export const SYSTEM = `You extract structured data from a single transactional email.

Hard rules:
1. Every value you return MUST be copied verbatim from the email text. You are
   given the exact text; quote from it.
2. For each field you must supply the exact substring of the email it came from,
   in "quote". The caller verifies every quote against the source and DISCARDS
   any field whose quote is not found. Inventing a quote silently loses the field.
3. If a field is not stated in the email, omit it. Never infer, never complete,
   never convert relative wording into a date.
4. If the email is marketing, a newsletter, an offer, a reminder to buy, or any
   message that is not a record of a specific transaction that already happened
   or is already scheduled for this recipient, return category "none" and no fields.
5. An email that mentions bookings, orders or cards but contains no booking /
   order / tracking / appointment / statement identifier for this recipient is
   marketing, not a transaction.`;

export const TOOL = {
  name: 'report_extraction',
  description: 'Report the category and the fields found verbatim in the email.',
  input_schema: {
    type: 'object' as const,
    properties: {
      category: {
        type: 'string',
        // Derived from the registry so this can never drift from the categories
        // that actually have an extractor behind them.
        enum: [...Object.keys(EXTRACTORS), 'none'],
      },
      fields: {
        type: 'array',
        description: 'One entry per field found. Omit fields the email does not state.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Field name from the target schema.' },
            value: { type: 'string', description: 'The value, as written in the email.' },
            quote: { type: 'string', description: 'Exact substring of the email containing the value.' },
          },
          required: ['name', 'value', 'quote'],
        },
      },
      reason: { type: 'string', description: 'Required when category is "none".' },
    },
    required: ['category', 'fields'],
  },
};

// Exhaustive over Category (minus 'none') so tsc refuses to compile until a
// new extractor's entry lands here too — the same forcing function already
// used for EXTRACTORS and CATEGORY_SIGNALS.
export const TARGET_FIELDS: Record<Exclude<Category, 'none'>, string[]> = {
  flight: ['reservationId', 'airline', 'flightNumber', 'departureAirport', 'arrivalAirport', 'departureTime', 'arrivalTime', 'seat'],
  train: ['pnr', 'operator', 'trainNumber', 'trainName', 'departureStation', 'arrivalStation', 'departureTime', 'arrivalTime', 'classOfTravel', 'coach', 'berth', 'fare'],
  bus: ['bookingId', 'operator', 'from', 'to', 'departureTime', 'arrivalTime', 'seats', 'boardingPoint', 'fare'],
  hotel: ['bookingId', 'hotel', 'location', 'checkIn', 'checkOut', 'nights', 'roomType', 'guests', 'total'],
  cab: ['bookingId', 'provider', 'pickup', 'drop', 'pickupTime', 'vehicle', 'fare'],
  food: ['merchant', 'orderId', 'items', 'total', 'status', 'eta', 'deliveryAddress'],
  shopping: ['merchant', 'orderId', 'items', 'total', 'status', 'expectedDelivery'],
  subscription: ['service', 'plan', 'amount', 'renewalDate', 'status'],
  event: ['reservationId', 'eventName', 'location', 'startDateTime', 'seats', 'amount'],
  refund: ['merchant', 'orderId', 'item', 'amount', 'status', 'eta'],
  medical: ['provider', 'specialty', 'location', 'dateTime', 'appointmentId'],
  'credit-card': ['issuer', 'cardLast4', 'statementDate', 'dueDate', 'totalDue', 'minDue'],
  bill: ['biller', 'account', 'amount', 'dueDate'],
  loan: ['lender', 'loanAccountId', 'emiAmount', 'dueDate', 'installmentNumber', 'outstanding', 'status'],
  insurance: ['insurer', 'policyNumber', 'policyType', 'premium', 'renewalDate', 'sumInsured'],
  salary: ['employer', 'payPeriod', 'netPay', 'grossPay', 'deductions', 'creditDate', 'payslipId'],
  restaurant: ['bookingId', 'restaurant', 'location', 'dateTime', 'partySize', 'table'],
  shipment: ['carrier', 'trackingId', 'item', 'expectedDelivery', 'orderId'],
};

export function buildUserMessage(doc: Doc, missing: string[], suspectedCategory: string | null): string {
  const schemaHint = Object.entries(TARGET_FIELDS)
    .map(([cat, fields]) => `- ${cat}: ${fields.join(', ')}`)
    .join('\n');

  return [
    `FROM: ${doc.sender.raw || '(unknown)'}`,
    '',
    'EMAIL TEXT (subject on the first line, then body):',
    '---',
    doc.text,
    '---',
    '',
    'Target field names per category:',
    schemaHint,
    '',
    suspectedCategory
      ? `Rule-based extraction guessed category "${suspectedCategory}" and could not find: ${missing.join(', ') || '(nothing)'}.`
      : 'Rule-based extraction found no category.',
    '',
    'Return only fields the email actually states, each with its verbatim quote.',
  ].join('\n');
}
