import { describe, expect, it } from 'vitest';
import { extract } from '../src/index.ts';
import { findMoney } from '../src/parse/money.ts';

const TODAY = '2026-09-15';

describe('promos that look like bookings still return none', () => {
  it('does not treat a coupon as an event booking id', () => {
    const r = extract({
      from: 'BookMyShow Offers <offers@bookmyshow.com>',
      subject: 'Flat 50% off Oppenheimer this weekend',
      body: 'Book any movie this weekend and get 50% off!\nMovie: Oppenheimer\nCinema: PVR Forum Mall, Bengaluru\nDate: Sat, 20 Sep 2026, 6:30 PM\nUse booking code SUMMER50 at checkout.\nSeats still available. T&C apply. Unsubscribe.',
    }, { today: TODAY });
    expect(r.category).toBe('none');
  });

  it('does not read the word "inside" from "booking ref inside" as a PNR', () => {
    const r = extract({
      from: 'MakeMyTrip <offers@makemytrip.com>',
      subject: 'Win a free flight — booking ref inside',
      body: 'Hurry! Book any IndiGo flight this week and get 40% off.\nAirline: IndiGo\nFlight 6E 202 from Delhi (DEL) to Mumbai (BOM)\nUse booking ref: SUMMER1 at checkout.\nBook now. T&C apply.',
    }, { today: TODAY });
    expect(r.category).toBe('none');
    expect(JSON.stringify(r.data ?? {})).not.toMatch(/inside/i);
  });

  it('does not extract a telco cashback blast as a bill', () => {
    const r = extract({
      from: 'Airtel Offers <marketing@airtel.com>',
      subject: 'Pay your bill, get 10% cashback',
      body: 'Exclusive offer! Pay your Airtel postpaid bill and get 10% cashback.\nBill amount: ₹899\nLast date of payment: 25 Sep 2026\nUse code CASHBACK10. Limited time offer. T&C apply.',
    }, { today: TODAY });
    expect(r.category).toBe('none');
  });

  it('does not extract a loan offer that mentions a card last-4 and a statement date', () => {
    const r = extract({
      from: 'HDFC Bank <offers@hdfcbank.net>',
      subject: 'Pre-approved personal loan on your credit card',
      body: 'Your HDFC Bank Credit Card ending 4821 is pre-approved for a personal loan of ₹5,00,000.\nStatement date: 15 Sep 2026\nApply now. Limited time offer. T&C apply.',
    }, { today: TODAY });
    expect(r.category).toBe('none');
  });
});

describe('wrong-span selection', () => {
  it('reads Total not Item total', () => {
    const r = extract({
      from: 'Swiggy <noreply@swiggy.in>',
      subject: 'Order confirmed',
      body: 'Your order from Burger Singh is confirmed.\nOrder ID: SW-9001\nItems: 1x Burger (₹248)\nItem total: ₹248\nDelivery fee: ₹40\nTotal: ₹288',
    }, { today: TODAY });
    expect(r.category).toBe('food');
    expect((r.data as any).total).toMatchObject({ amount: 288, currency: 'INR' });
  });

  it('does not glue "Booked on" onto the departure clock', () => {
    const r = extract({
      from: 'IndiGo <no-reply@goindigo.in>',
      subject: 'Booking Confirmed — PNR QW12ER',
      body: 'Dear Passenger, your booking is confirmed. Booked on 01 Sep 2026.\nPNR: QW12ER\nFlight 6E-5312 from Bengaluru (BLR) to Delhi (DEL)\nDeparts 08:15, arrives 10:45.\nSeat 12C.',
    }, { today: TODAY });
    expect(r.category).toBe('flight');
    expect((r.data as any).departureTime ?? '').not.toMatch(/^2026-09-01/);
    expect((r.data as any).departureAirport).toBe('BLR');
  });

  it('still reads a travel date that is actually next to departs', () => {
    const r = extract({
      from: 'Air India <no-reply@airindia.com>',
      subject: 'Booking Confirmed — PNR X4K9P2',
      body: 'Dear Passenger, your booking is confirmed. PNR: X4K9P2. Flight AI-302 from Delhi (DEL) to Mumbai (BOM) on 12 Sep 2026, departs 08:15, arrives 10:30. Seat 14A. Fare INR 6,540.',
    }, { today: TODAY });
    expect((r.data as any).departureTime).toBe('2026-09-12T08:15');
  });
});

describe('Indian phrasing', () => {
  it('reads lakh as 100,000', () => {
    expect(findMoney('Total amount due: ₹1.5 lakh')?.value).toMatchObject({
      amount: 150000, currency: 'INR', raw: '₹1.5 lakh',
    });
  });

  it('extracts a BESCOM bill written as "kindly remit … on or before"', () => {
    const r = extract({
      from: 'BESCOM <no-reply@bescom.co.in>',
      subject: 'Electricity charges for Sep 2026',
      body: 'Dear Consumer,\nKindly remit ₹1,200 on or before 25/09/2026 to avoid disconnection.\nAccount number: 771122\nUnits consumed: 184 kWh.',
    }, { today: TODAY });
    expect(r.category).toBe('bill');
    expect((r.data as any).amount).toMatchObject({ amount: 1200, currency: 'INR' });
    expect((r.data as any).dueDate).toBe('2026-09-25');
    expect((r.data as any).account).toBe('771122');
  });
});
