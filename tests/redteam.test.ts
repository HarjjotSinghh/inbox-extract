import { describe, expect, it } from 'vitest';
import { Doc, extract, ground } from '../src/index.ts';
import { findMoney } from '../src/parse/money.ts';
import type { Provenance } from '../src/types.ts';

const TODAY = '2026-09-15';

/**
 * Regressions from an adversarial pass over 71 synthetic emails. Each of these
 * failed before the fix that sits beside it; they are here so the fix stays.
 */

describe('a figure must not absorb the number after it', () => {
  // "₹1,842 214 units consumed" was read as ₹18,42,214 — a fabricated number
  // that appeared nowhere in the email, at confidence "high".
  const cases: Array<[string, number]> = [
    ['Bill amount: ₹1,842 214 units consumed', 1842],
    ['Refund amount: ₹2,499 3-5 business days', 2499],
    ['Order total: ₹450 4 items', 450],
    ['₹450.00 4 items', 450],
    ['Total: ₹1,81,550', 181550],
    ['Rs. 42,310.55', 42310.55],
  ];
  for (const [text, amount] of cases) {
    it(`${text} -> ${amount}`, () => {
      expect(findMoney(text)?.value.amount).toBe(amount);
    });
  }

  it('reports a ₹1,842 bill as ₹1,842', () => {
    const r = extract({
      from: 'BESCOM <billalert@bescom.co.in>',
      subject: 'Electricity bill ready',
      body: 'Consumer number: 5501234567\nBill amount: ₹1,842 214 units consumed\nDue date: 25 Sep 2026',
    }, { today: TODAY });
    expect((r.data as any).amount).toMatchObject({ amount: 1842, currency: 'INR' });
  });

  it('drops an amount that its own raw text does not support', () => {
    const doc = new Doc({ body: 'Total: ₹450' });
    const at = doc.text.indexOf('₹450');
    const data: Record<string, unknown> = {
      total: { amount: 4504, currency: 'INR', raw: '₹450' }, // amount not derivable from raw
    };
    const provenance: Record<string, Provenance> = {
      total: { source: 'text', quote: '₹450', start: at, end: at + 4, rule: 'test' },
    };
    ground(doc, data, provenance);
    expect(data.total).toBeUndefined();
  });
});

describe('an ordinary promo footer must not delete a real transaction', () => {
  it('keeps a Swiggy order that ends with "Get 50% off your next order"', () => {
    const r = extract({
      from: 'Swiggy <no-reply@swiggy.in>',
      subject: 'Your Swiggy order is on the way',
      body: 'Your Swiggy order from Meghana Foods is on the way.\nItems: 1x Chicken Biryani (₹320), 1x Coke (₹60)\nTotal: ₹380\nDelivering to: 12 MG Road, Bengaluru\n\n---\nGet 50% off your next order. T&C apply.\nUnsubscribe',
    }, { today: TODAY });
    expect(r.category).toBe('food');
    expect((r.data as any).total).toMatchObject({ amount: 380 });
  });

  it('keeps an Airtel bill whose last paragraph is cashback boilerplate', () => {
    const r = extract({
      from: 'Airtel <bills@airtel.in>',
      subject: 'Your Airtel postpaid bill',
      body: 'Your Airtel postpaid bill is ready.\nBill amount: ₹899\nDue date: 25 Sep 2026\n\nPay now and get 10% cashback up to ₹100. T&C apply. Unsubscribe',
    }, { today: TODAY });
    expect(r.category).toBe('bill');
    expect((r.data as any).dueDate).toBe('2026-09-25');
  });
});

describe('an inducement is not a transaction, even with amount + date + account', () => {
  it('rejects "Pay ₹799 before 30 Sep and enjoy double data"', () => {
    const r = extract({
      from: 'Jio <marketing@jio.com>',
      subject: 'Your recharge plan is about to get better',
      body: 'Pay ₹799 before 30 Sep 2026 and enjoy double data.\nAmount payable: ₹799\nPay by: 30 Sep 2026\nConsumer number: 9812345678',
    }, { today: TODAY });
    expect(r.category).toBe('none');
  });

  it('rejects a credit-limit increase that quotes a card last-4 and a statement date', () => {
    const r = extract({
      from: 'ICICI Bank <cards@icicibank.com>',
      subject: 'Card ending 7712: your credit limit has been increased',
      body: 'Good news! The credit limit on your credit card ending 7712 is now ₹4,50,000.\nTotal credit limit: ₹4,50,000\nAvailable credit limit: ₹4,50,000\nStatement date: 05 Sep 2026',
    }, { today: TODAY });
    expect(r.category).toBe('none');
  });
});

describe('item lists are read whole or not at all', () => {
  it('reads a list that mixes bare names and quantities', () => {
    const r = extract({
      from: 'Zomato <no-reply@zomato.com>',
      subject: 'Order confirmed',
      body: 'Your order from Truffles is confirmed.\nOrder ID: ZOM1\nItems: Chicken Biryani, 2x Coke, Paneer Tikka\nTotal: ₹720',
    }, { today: TODAY });
    expect((r.data as any).items).toHaveLength(3);
    expect((r.data as any).items.map((i: any) => i.name)).toEqual(['Chicken Biryani', 'Coke', 'Paneer Tikka']);
  });

  it('reads a list written one item per line', () => {
    const r = extract({
      from: 'Zomato <no-reply@zomato.com>',
      subject: 'Order confirmed',
      body: 'Your order from Truffles is confirmed.\nOrder ID: ZOM2\nItems:\nChicken Biryani x 1\nCoke x 2\nPaneer Tikka x 1\nTotal: ₹720',
    }, { today: TODAY });
    expect((r.data as any).items).toHaveLength(3);
    expect((r.data as any).total).toMatchObject({ amount: 720 });
  });

  it('does not mistake a product name containing "x" for a quantity', () => {
    const r = extract({
      from: 'Zomato <no-reply@zomato.com>',
      subject: 'Order confirmed',
      body: 'Your order from Play Cafe is confirmed.\nOrder ID: ZOM3\nItems: Burger x Fries combo, Coke\nTotal: ₹450',
    }, { today: TODAY });
    expect((r.data as any).items.map((i: any) => i.name)).toContain('Burger x Fries combo');
  });
});

describe('a paid bill is not overdue', () => {
  it('reads "we have received your payment" instead of scoring the due date', () => {
    const r = extract({
      from: 'BESCOM <billalert@bescom.co.in>',
      subject: 'Payment received — thank you',
      body: 'We have received your payment. No action is needed.\nConsumer number: 5501234567\nBill amount: ₹1,842\nDue date: 05 Sep 2026',
    }, { today: TODAY });
    expect((r.data as any).status).toBe('paid');
    expect((r.data as any).paymentStatus).toBe('https://schema.org/PaymentComplete');
  });
});

describe('a PNR alone does not make something a flight', () => {
  it('reads an IRCTC train ticket as a train booking, never as a FlightReservation', () => {
    const r = extract({
      from: 'IRCTC <ticketadmin@irctc.co.in>',
      subject: 'Ticket confirmed',
      body: 'PNR: 4523118876\nTrain: 12658 KSR Bengaluru Express\nDate of journey: 20 Sep 2026\nSeat 32A\nFare: ₹1,245',
    }, { today: TODAY });
    expect(r.category).toBe('train');
    expect(r.schemaType).toBe('TrainReservation');
  });

  it('still reads a real flight, whose PNR sits beside a flight number and IATA codes', () => {
    const r = extract({
      from: 'Air India <no-reply@airindia.com>',
      subject: 'Booking Confirmed — PNR X4K9P2',
      body: 'PNR: X4K9P2. Flight AI-302 from Delhi (DEL) to Mumbai (BOM) on 12 Sep 2026, departs 08:15, arrives 10:30. Seat 14A.',
    }, { today: TODAY });
    expect(r.category).toBe('flight');
    expect((r.data as any).reservationId).toBe('X4K9P2');
  });
});

describe('regressions from building the 18-category rework', () => {
  it('an overnight train does not stamp the arrival with the departure date', () => {
    // 22:40 departure / 05:45 arrival with one journey date stated: the
    // arrival is the next calendar day, which the email never states.
    // Composing it from the departure date would fabricate a same-day arrival.
    const r = extract({
      from: 'IRCTC <ticketadmin@irctc.co.in>',
      subject: 'Ticket confirmed',
      body: 'PNR: 2458109763\nTrain: 12658 - KSR Bengaluru City Express\nDate of journey: 20 Sep 2026\nFrom: KSR Bengaluru\nTo: Chennai Central\nDeparture time: 22:40\nArrival time: 05:45',
    }, { today: TODAY });

    expect(r.category).toBe('train');
    expect((r.data as any).departureTime).toBe('2026-09-20T22:40');
    expect((r.data as any).arrivalTime).toBe('05:45');
    expect(r.partial).toContain('arrivalTime');
  });

  it('trainName does not repeat the leading train number when there is no dash', () => {
    const r = extract({
      from: 'IRCTC <ticketadmin@irctc.co.in>',
      subject: 'Ticket confirmed',
      body: 'PNR: 2458109763\nTrain: 12658 KSR Bengaluru City Express\nDate of journey: 20 Sep 2026\nFrom: KSR Bengaluru\nTo: Chennai Central\nDeparture time: 22:40',
    }, { today: TODAY });

    expect((r.data as any).trainName).toBe('KSR Bengaluru City Express');
  });

  it('an EMI amount with "Rs." is not truncated by the period inside it', () => {
    // A blob-capture regex ([^.\n]{1,30}) stops at the first '.', which sits
    // inside "Rs." itself — "EMI of Rs. 12,300" captured just "Rs" with no
    // digits, so the amount was silently dropped.
    const r = extract({
      from: 'HDFC Bank <loans@hdfcbank.net>',
      subject: 'EMI reminder',
      body: 'Your EMI of Rs. 12,300 for Personal Loan is due on 20 Sep 2026.\nLoan Account Number: HDFCPL5521190',
    }, { today: TODAY });

    expect(r.category).toBe('loan');
    expect((r.data as any).emiAmount).toMatchObject({ amount: 12300, currency: 'INR' });
    expect((r.data as any).dueDate).toBe('2026-09-20');
  });
});

describe('malformed input abstains instead of throwing', () => {
  const bad: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['numeric body', { body: 12345 }],
    ['empty object', {}],
    ['null fields', { from: null, subject: null, body: null }],
  ];
  for (const [label, input] of bad) {
    it(label, () => {
      const r = extract(input as never, { today: TODAY });
      expect(r.category).toBe('none');
      expect(r.data).toBeNull();
    });
  }
});
