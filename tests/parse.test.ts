import { describe, expect, it } from 'vitest';
import { Doc, extract, parseSender } from '../src/index.ts';
import { findDateTime, to24h } from '../src/parse/datetime.ts';
import { parseItems } from '../src/parse/items.ts';
import { findMoney, parseAmount } from '../src/parse/money.ts';
import { labelValue, valueEnd } from '../src/parse/text.ts';

describe('money', () => {
  it('reads Indian lakh grouping', () => {
    expect(parseAmount('1,81,550')).toBe(181550);
    expect(findMoney('Available credit limit: ₹1,81,550.')?.value).toMatchObject({ amount: 181550, currency: 'INR' });
  });

  it('reads Western grouping and decimals', () => {
    expect(findMoney('Total amount due: ₹18,450.00')?.value).toMatchObject({ amount: 18450, currency: 'INR' });
    expect(findMoney('Rs. 42,310.55')?.value).toMatchObject({ amount: 42310.55, currency: 'INR' });
    expect(findMoney('USD 129.99')?.value).toMatchObject({ amount: 129.99, currency: 'USD' });
  });

  it('keeps the source text so the value can be traced back', () => {
    expect(findMoney('charged ₹649 to')?.value.raw).toBe('₹649');
  });

  it('does not read a percentage as an amount', () => {
    expect(findMoney('at 10.5% p.a.')).toBeNull();
  });
});

describe('dates', () => {
  it('reads the day-month-year forms transactional email uses', () => {
    expect(findDateTime('Sat, 20 Sep 2026, 6:30 PM')?.value).toMatchObject({ value: '2026-09-20T18:30', kind: 'datetime' });
    expect(findDateTime('Due date: 25 Sep 2026')?.value).toMatchObject({ value: '2026-09-25', kind: 'date' });
    expect(findDateTime('Sep 20, 2026')?.value.value).toBe('2026-09-20');
  });

  it('returns a bare time as a time, not a date', () => {
    expect(findDateTime('Estimated delivery: 8:45 PM')?.value).toMatchObject({ value: '20:45', kind: 'time' });
  });

  it('flags a numeric date that could be read either way', () => {
    // 05/09 is genuinely 5 Sep or 9 May; day-first is emitted and flagged.
    expect(findDateTime('05/09/2026')?.value).toMatchObject({ value: '2026-09-05', ambiguous: true });
    // 20 and 25 cannot be months, so these need no guess.
    expect(findDateTime('20/09/2026')?.value).toMatchObject({ value: '2026-09-20', ambiguous: false });
    expect(findDateTime('25/09/2026')?.value).toMatchObject({ value: '2026-09-25', ambiguous: false });
  });

  it('converts meridiem correctly at the boundaries', () => {
    expect(to24h(12, 0, 'AM')).toBe('00:00');
    expect(to24h(12, 30, 'PM')).toBe('12:30');
    expect(to24h(11, 0, 'PM')).toBe('23:00');
  });
});

describe('label scanning', () => {
  const doc = new Doc({
    subject: 'Appointment confirmed',
    body: 'Doctor: Dr. Anita Rao (Dermatologist). Clinic: Skin & You, Indiranagar. Date & time: Mon, 22 Sep 2026, 11:00 AM.',
  });

  it('does not treat an abbreviation full stop as the end of a value', () => {
    expect(labelValue(doc, 't', ['Doctor'])?.value).toBe('Dr. Anita Rao (Dermatologist)');
  });

  it('stops at a genuine sentence boundary', () => {
    expect(labelValue(doc, 't', ['Clinic'])?.value).toBe('Skin & You, Indiranagar');
  });

  it('tolerates ampersands and spacing in the label itself', () => {
    expect(labelValue(doc, 't', ['Date & time'])?.value).toBe('Mon, 22 Sep 2026, 11:00 AM');
    expect(labelValue(doc, 't', ['Date and time'])?.value).toBe('Mon, 22 Sep 2026, 11:00 AM');
  });

  it('refuses a nested label when told the longer phrase', () => {
    const d = new Doc({ body: 'Available credit limit: ₹1,81,550.' });
    expect(labelValue(d, 't', ['Credit limit'])?.value).toBe('₹1,81,550');
    expect(labelValue(d, 't', ['Credit limit'], { notPartOf: ['Available credit limit'] })).toBeNull();
  });

  it('runs a value to the end of the text when nothing terminates it', () => {
    expect(valueEnd('Total: 380', 7)).toBe(10);
  });
});

describe('HTML table cells (added for the 18-category rework)', () => {
  it('collapse() preserves a tab as the cell separator instead of folding it into a space', () => {
    const doc = new Doc({ body: '<table><tr><td>Due Date</td><td>20 Sep 2026</td></tr></table>' });
    expect(labelValue(doc, 't', ['Due Date'])?.value).toBe('20 Sep 2026');
  });

  it('a multiline label stops at the next table row, not the whole table', () => {
    // Before the fix, valueEndMultiline only recognised ':' as a new-label
    // boundary, so a tab-separated row after a multiline field was swallowed
    // into the same value.
    const doc = new Doc({
      body: '<table><tr><td>Items</td><td>1x Widget</td></tr><tr><td>Total</td><td>Rs. 199</td></tr></table>',
    });
    const items = labelValue(doc, 't', ['Items'], { multiline: true });
    expect(items?.value).toBe('1x Widget');
  });
});

describe('line-item splitting (added for the 18-category rework)', () => {
  it('does not split a comma inside a parenthesised price', () => {
    const span = { value: '1x Cotton Shirt (₹1,299), 1x Denim Jeans (₹1,999)', quote: 'x', start: 0, end: 1, source: 'text' as const, rule: 't' };
    const items = parseItems(span);
    expect(items?.value).toHaveLength(2);
    expect(items?.value[0]).toMatchObject({ name: 'Cotton Shirt', price: { amount: 1299 } });
    expect(items?.value[1]).toMatchObject({ name: 'Denim Jeans', price: { amount: 1999 } });
  });
});

describe('sender parsing', () => {
  it('splits display name, mailbox and brand', () => {
    expect(parseSender('HDFC Bank Offers <offers@hdfcbank.net>')).toMatchObject({
      displayName: 'HDFC Bank Offers', localPart: 'offers', domain: 'hdfcbank.net', brandToken: 'hdfcbank',
    });
  });

  it('folds country second-level domains', () => {
    expect(parseSender('Amazon.in <returns@amazon.in>').brandToken).toBe('amazon');
    expect(parseSender('BESCOM <no-reply@bescom.co.in>').brandToken).toBe('bescom');
  });
});

describe('layer 0: schema.org markup the sender already published', () => {
  const html = `<html><body>
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "FlightReservation",
      "reservationId": "QQ77ZZ",
      "airplaneSeat": "2C",
      "reservationFor": {
        "@type": "Flight",
        "flightNumber": "6E-5312",
        "airline": { "@type": "Airline", "name": "IndiGo" },
        "departureAirport": { "@type": "Airport", "iataCode": "BLR" },
        "departureTime": "2026-10-04T06:20:00+05:30",
        "arrivalAirport": { "@type": "Airport", "iataCode": "DEL" },
        "arrivalTime": "2026-10-04T09:05:00+05:30"
      }
    }
    </script>
    <p>Your trip is booked. Details are in this email.</p>
  </body></html>`;

  it('uses the markup instead of re-deriving it from prose', () => {
    const r = extract({ from: 'IndiGo <no-reply@goindigo.in>', subject: 'Trip booked', body: html });
    expect(r.method).toBe('jsonld');
    expect(r.category).toBe('flight');
    expect(r.data).toMatchObject({
      reservationId: 'QQ77ZZ', airline: 'IndiGo', flightNumber: '6E 5312',
      departureAirport: 'BLR', arrivalAirport: 'DEL',
      departureTime: '2026-10-04T06:20', arrivalTime: '2026-10-04T09:05', seat: '2C',
    });
    expect(r.missing).toEqual([]);
    expect(r.confidence).toBe('high');
  });

  it('strips markup and tags out of the readable text', () => {
    const doc = new Doc({ body: html });
    expect(doc.text).toContain('Your trip is booked.');
    expect(doc.text).not.toContain('<p>');
    expect(doc.text).not.toContain('application/ld+json');
  });
});
