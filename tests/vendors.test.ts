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
});
