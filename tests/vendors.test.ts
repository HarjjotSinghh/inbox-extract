import { describe, expect, it } from 'vitest';
import { extract } from '../src/index.ts';

const TODAY = '2026-09-15';

/**
 * None of these senders appear in the fixtures. They exist to check that the
 * rules key off the vendor-agnostic label/phrase layer rather than off the six
 * brands that happen to be in the sample.
 */
describe('senders that are not in the fixtures', () => {
  it('food: Swiggy, different labels, no ETA stated', () => {
    const r = extract({
      from: 'Swiggy <noreply@swiggy.in>',
      subject: 'Order confirmed',
      body: "Thanks! Your order from Truffles has been placed. Order ID: SW-55123. Items: 2x Veg Burger (₹198), 1x Fries (₹99). Grand total: ₹297. Delivering to: 4th Block, Koramangala.",
    }, { today: TODAY });

    expect(r.category).toBe('food');
    expect((r.data as any).merchant).toBe('Truffles');
    expect((r.data as any).orderId).toBe('SW-55123');
    expect((r.data as any).items).toHaveLength(2);
    expect((r.data as any).total).toMatchObject({ amount: 297, currency: 'INR' });
    // The email never states a delivery time, so it is reported absent.
    expect(r.missing).toContain('eta');
  });

  it('shipment: Flipkart via Blue Dart, "Tracking number" not "Tracking ID"', () => {
    const r = extract({
      from: 'Flipkart <noreply@flipkart.com>',
      subject: 'Shipped: your Flipkart order',
      body: "Your item 'Logitech MX Master 3S' has been dispatched via Blue Dart. Tracking number: BD5566778899. Order ID: OD1122334455. Expected delivery: 21 Sep 2026.",
    }, { today: TODAY });

    expect(r.category).toBe('shipment');
    expect(r.data).toMatchObject({
      carrier: 'Blue Dart',
      trackingId: 'BD5566778899',
      item: 'Logitech MX Master 3S',
      expectedDelivery: '2026-09-21',
      orderId: 'OD1122334455',
    });
    expect(r.missing).toEqual([]);
  });

  it('subscription: Spotify trial ending, distinguished from a renewal', () => {
    const r = extract({
      from: 'Spotify <no-reply@spotify.com>',
      subject: 'Your free trial ends soon',
      body: "Your Spotify Premium trial ends on 30 Sep 2026. After that you'll be charged ₹119 per month.",
    }, { today: TODAY });

    expect(r.category).toBe('subscription');
    expect(r.data).toMatchObject({
      service: 'Spotify', plan: 'Premium', status: 'trial-ending', renewalDate: '2026-09-30',
    });
    expect((r.data as any).amount).toMatchObject({ amount: 119 });
  });

  it('medical: Apollo, "Reference" instead of "Appointment ID"', () => {
    const r = extract({
      from: 'Apollo Hospitals <appointments@apollo247.com>',
      subject: 'Appointment booked',
      body: 'Appointment booked with Dr. Rakesh Menon (Cardiologist). Hospital: Apollo Jubilee Hills, Hyderabad. When: 28 Sep 2026, 4:15 PM. Reference: AP-90210.',
    }, { today: TODAY });

    expect(r.category).toBe('medical');
    expect(r.data).toMatchObject({
      provider: 'Dr. Rakesh Menon',
      specialty: 'Cardiologist',
      location: 'Apollo Jubilee Hills, Hyderabad',
      dateTime: '2026-09-28T16:15',
      appointmentId: 'AP-90210',
    });
  });

  it('credit-card: ICICI, masked card, "Pay by" instead of "Payment due date"', () => {
    const r = extract({
      from: 'ICICI Bank <statements@icicibank.com>',
      subject: 'Credit card statement for Sep 2026',
      body: 'Statement for your card XXXX1234. Statement date: 05 Sep 2026. Total payment due: Rs. 42,310.55. Minimum payment due: Rs. 2,120.00. Pay by: 25 Sep 2026.',
    }, { today: TODAY });

    expect(r.category).toBe('credit-card');
    expect(r.data).toMatchObject({
      issuer: 'ICICI Bank', cardLast4: '1234',
      statementDate: '2026-09-05', dueDate: '2026-09-25', status: 'upcoming',
    });
    expect((r.data as any).totalDue).toMatchObject({ amount: 42310.55, currency: 'INR' });
    expect((r.data as any).minDue).toMatchObject({ amount: 2120, currency: 'INR' });
  });

  it('refund: Myntra cancellation is reported as cancelled, not refunded', () => {
    const r = extract({
      from: 'Myntra <returns@myntra.com>',
      subject: 'Your order has been cancelled',
      body: 'Order #MYN-77881 (Nike Revolution 7) has been cancelled. ₹3,499 will be credited back to your original payment method within 5 business days.',
    }, { today: TODAY });

    expect(r.category).toBe('refund');
    expect((r.data as any).status).toBe('cancelled');
    expect((r.data as any).orderId).toBe('MYN-77881');
    expect(r.partial).toContain('eta');
  });

  it('an unrecognised promo from a transactional-looking mailbox is still rejected', () => {
    const r = extract({
      from: 'Uber Eats <no-reply@ubereats.com>',
      subject: 'Free delivery on your next 5 orders',
      body: 'Order any restaurant this week and pay zero delivery fee. Use code FREEDEL. Offer valid till 30 Sep. T&C apply.',
    }, { today: TODAY });

    expect(r.category).toBe('none');
  });

  it('train: ConfirmTkt, "Boarding station"/"Destination station" instead of From/To', () => {
    const r = extract({
      from: 'ConfirmTkt <alerts@confirmtkt.com>',
      subject: 'PNR Status: Confirmed',
      body: 'PNR 8871234456: Train 12951 Mumbai Rajdhani. Boarding station: Mumbai Central. Destination station: New Delhi. Date of journey: 22 Sep 2026. Departure time: 17:05. Class: 2A. Coach A1, Berth 22 Lower.',
    }, { today: TODAY });

    expect(r.category).toBe('train');
    expect(r.data).toMatchObject({
      pnr: '8871234456', trainNumber: '12951', departureStation: 'Mumbai Central',
      arrivalStation: 'New Delhi', departureTime: '2026-09-22T17:05', classOfTravel: '2A',
    });
  });

  it('bus: IntrCity SmartBus, "Pickup point" instead of "Boarding point"', () => {
    const r = extract({
      from: 'IntrCity SmartBus <tickets@intrcity.com>',
      subject: 'Your SmartBus ticket is confirmed',
      body: 'Booking ID: IC7723841. Operator: IntrCity SmartBus. From: Pune. To: Bengaluru. Departure: 22 Sep 2026, 20:00. Pickup point: Hinjewadi Phase 1. Fare: Rs. 1,650.',
    }, { today: TODAY });

    expect(r.category).toBe('bus');
    expect(r.data).toMatchObject({ bookingId: 'IC7723841', from: 'Pune', to: 'Bengaluru' });
  });

  it('hotel: Goibibo, nights computed from check-in/check-out rather than stated', () => {
    const r = extract({
      from: 'Goibibo <bookings@goibibo.com>',
      subject: 'Booking confirmed',
      body: 'Booking ID: GO4471820. Hotel: The Fern Residency. Check-in: 12 Oct 2026. Check-out: 15 Oct 2026. Room type: Executive. Total amount: Rs. 9,600.',
    }, { today: TODAY });

    expect(r.category).toBe('hotel');
    expect(r.data).toMatchObject({
      bookingId: 'GO4471820', hotel: 'The Fern Residency', checkIn: '2026-10-12', checkOut: '2026-10-15', nights: 3,
    });
  });

  it('cab: Rapido, "Trip fare" instead of "Fare estimate"', () => {
    const r = extract({
      from: 'Rapido <no-reply@rapido.bike>',
      subject: 'Your ride is confirmed',
      body: 'Booking ID: RP9981234. Pickup location: HSR Layout. Drop location: Electronic City. Pickup date & time: 22 Sep 2026, 08:00. Vehicle: Bike. Trip fare: Rs. 85.',
    }, { today: TODAY });

    expect(r.category).toBe('cab');
    expect(r.data).toMatchObject({ bookingId: 'RP9981234', pickup: 'HSR Layout', drop: 'Electronic City' });
  });

  it('shopping: Nykaa, multi-day delivery distinguishes it from a food order', () => {
    const r = extract({
      from: 'Nykaa <care@nykaa.com>',
      subject: 'Your Nykaa order is confirmed',
      body: 'Thank you for shopping with Nykaa. Order ID: NYK8871234. Items: 1x Face Serum (₹899). Order total: ₹899. Expected delivery: 27 Sep 2026.',
    }, { today: TODAY });

    expect(r.category).toBe('shopping');
    expect(r.data).toMatchObject({ merchant: 'Nykaa', orderId: 'NYK8871234', expectedDelivery: '2026-09-27' });
  });

  it('loan: Tata Capital, "Instalment" (single-l) spelling', () => {
    const r = extract({
      from: 'Tata Capital <loans@tatacapital.com>',
      subject: 'Instalment reminder',
      body: 'Lender: Tata Capital. Loan Account Number: TC5521904. Instalment amount: Rs. 6,750. Due date: 28 Sep 2026. Outstanding balance: Rs. 2,10,000.',
    }, { today: TODAY });

    expect(r.category).toBe('loan');
    expect(r.data).toMatchObject({ lender: 'Tata Capital', loanAccountId: 'TC5521904', dueDate: '2026-09-28' });
    expect((r.data as any).emiAmount).toMatchObject({ amount: 6750, currency: 'INR' });
  });

  it('insurance: Star Health, "Sum assured" instead of "Sum insured"', () => {
    const r = extract({
      from: 'Star Health <renewals@starhealth.in>',
      subject: 'Health insurance renewal due',
      body: 'Insurer: Star Health. Policy number: SH88213047. This is a health insurance policy. Premium amount: Rs. 18,900. Policy expiry date: 05 Oct 2026. Sum assured: Rs. 10,00,000.',
    }, { today: TODAY });

    expect(r.category).toBe('insurance');
    expect(r.data).toMatchObject({ insurer: 'Star Health', policyNumber: 'SH88213047', policyType: 'health' });
  });

  it('salary: an employer with no payroll-platform brand at all, "Payslip reference"', () => {
    const r = extract({
      from: 'Initech Systems <hr@initech.example>',
      subject: 'Salary Slip - September 2026',
      body: 'Employer: Initech Systems. Pay period: September 2026. Net pay: Rs. 61,200. Credited on: 30 Sep 2026. Payslip reference: IS-2609-771.',
    }, { today: TODAY });

    expect(r.category).toBe('salary');
    expect(r.data).toMatchObject({ employer: 'Initech Systems', payPeriod: 'September 2026', creditDate: '2026-09-30' });
  });

  it('restaurant: an independent restaurant with no dining-platform brand', () => {
    const r = extract({
      from: 'Om Prakash Restaurant <bookings@omprakashrestaurant.in>',
      subject: 'Table reserved',
      body: 'Booking ID: OP44120. Restaurant: Om Prakash Restaurant. Date & time: 23 Sep 2026, 20:00. Party size: 6. Table: 9.',
    }, { today: TODAY });

    expect(r.category).toBe('restaurant');
    expect(r.data).toMatchObject({ bookingId: 'OP44120', restaurant: 'Om Prakash Restaurant', partySize: 6 });
  });
});
