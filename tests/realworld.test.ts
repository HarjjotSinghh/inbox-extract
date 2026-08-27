import { describe, expect, it } from 'vitest';
import { extract } from '../src/index.ts';

// Regressions transcribed from the first day of the Chrome extension running
// on a real inbox (2026-08-27). Bodies are reconstructed around the wording
// visible in the reports; the discriminating phrases are verbatim.
const TODAY = '2026-08-27';

const perforaPickedUp = {
  from: 'no-reply <no-reply@perfora.in>',
  subject: 'Your Order from Perfora Care has been picked up',
  body:
    'Your package has left the warehouse. Order #P20211168842. ' +
    'Items: 1x Mint Fresh Toothpaste, 1x Tongue Cleaner, 1x Mouth Freshener Spray. ' +
    'Order total: ₹517. Expected delivery: 16 Aug 2026. Track your package at perfora.in/track.',
};

const openaiTopUp = {
  from: 'OpenAI <noreply@openai.com>',
  subject: 'Your OpenAI API account has been funded',
  body:
    'Hi there, We charged $59.00 to your credit card on file to fund your API account. ' +
    'Your new credit balance is $59.00. You can view your usage and billing settings in ' +
    'the developer dashboard. Thank you for building with OpenAI!',
};

describe('a retail parcel is not food', () => {
  it('an oral-care order that has left the warehouse lands on a parcel category', () => {
    const r = extract(perforaPickedUp, { today: TODAY });
    expect(r.category).not.toBe('food');
    expect(['shipment', 'shopping']).toContain(r.category);
  });

  it('a genuine food order still wins food', () => {
    const r = extract(
      {
        from: 'Zomato <order@zomato.com>',
        subject: 'Your order is on the way — Order #ZO987654',
        body:
          'Your order from Meghana Foods is on the way! Order #ZO987654. ' +
          'Items: 1x Chicken Biryani (₹320), 1x Coke (₹60). Total: ₹380. Estimated delivery: 8:45 PM.',
      },
      { today: TODAY },
    );
    expect(r.category).toBe('food');
  });
});

describe('a card charge receipt is not a card statement', () => {
  it('an API-credit top-up that mentions "your credit card" abstains', () => {
    const r = extract(openaiTopUp, { today: TODAY });
    expect(r.category).toBe('none');
  });
});

describe('a shipped retail order is not food either', () => {
  // A real Capes India (phone-case) shipping notice extracted as 'food':
  // subject wording is all parcel ("shipped", "Tracking Details"), but food's
  // bare-order-id anchor plus its higher lexical rank won the day.
  it('a phone-case shipping notice lands on a parcel category', () => {
    const r = extract(
      {
        from: 'Capes India <hello@capesindia.com>',
        subject: 'Your order has been shipped, Tracking Details for your order #C394447.',
        body:
          'Your order is on the way & has been dispatched from our warehouse in Mumbai. ' +
          'Order #C394447. iPhone 16 Pro Max Transparent Clear Armour Anti-Yellow MagSafe Case. ' +
          'Track your package for delivery updates.',
      },
      { today: TODAY },
    );
    expect(r.category).not.toBe('food');
    expect(['shipment', 'shopping']).toContain(r.category);
  });
});

describe('an appointment is not automatically medical', () => {
  it('an Apple carry-in repair booking abstains from medical', () => {
    const r = extract(
      {
        from: 'Apple Support <no_reply@email.apple.com>',
        subject: 'Your carry-in appointment at Future World Retail Pvt Ltd has been scheduled.',
        body:
          'Appointment scheduled. Your carry-in appointment for your iPhone has been scheduled at ' +
          'Future World Retail Pvt Ltd, Koramangala, Bengaluru on 28 Aug 2026, 11:30 AM. ' +
          'Case ID: 102938475. Please bring your device and proof of purchase.',
      },
      { today: TODAY },
    );
    expect(r.category).not.toBe('medical');
  });

  it('a genuine doctor appointment still wins medical', () => {
    const r = extract(
      {
        from: 'Practo <appointments@practo.com>',
        subject: 'Appointment confirmed with Dr. Anita Rao',
        body:
          'Your appointment is confirmed. Doctor: Dr. Anita Rao (Dermatologist). Clinic: Skin & You, ' +
          'Indiranagar, Bengaluru. Date & time: Mon, 22 Sep 2026, 11:00 AM. Appointment ID: PR-448291.',
      },
      { today: TODAY },
    );
    expect(r.category).toBe('medical');
  });
});

// From the Codex review of PR #2: each guard added above must not cost the
// genuine case it sits next to.
describe('review follow-ups: the guards keep their genuine neighbours', () => {
  it('a health-platform template with generic labels is still medical', () => {
    const r = extract(
      {
        from: 'Practo <appointments@practo.com>',
        subject: 'Your appointment is confirmed',
        body:
          'Provider: Anita Rao. Location: Indiranagar, Bengaluru. ' +
          'Date & time: Mon, 22 Sep 2026, 11:00 AM. Appointment ID: PR-990011.',
      },
      { today: TODAY },
    );
    expect(r.category).toBe('medical');
  });

  it('a failure email that states an initiated refund is still a refund', () => {
    const r = extract(
      {
        from: 'Amazon.in <order-update@amazon.in>',
        subject: 'Payment failed — refund initiated for order #402-9911',
        body:
          'Your payment for order #402-9911 failed. We have initiated a refund of ₹1,299 to your ' +
          'original payment method. It will reflect in 3-5 business days.',
      },
      { today: TODAY },
    );
    expect(r.category).toBe('refund');
  });

  it('a dispatched quick-commerce grocery order is still food', () => {
    const r = extract(
      {
        from: 'Blinkit <no-reply@blinkit.com>',
        subject: 'Your order has been dispatched',
        body:
          'Your Blinkit order is on the way! Order ID: BLK4455667. Items: 1x Milk 1L, 1x Bread. ' +
          'Total: ₹98. Arriving in 9 minutes.',
      },
      { today: TODAY },
    );
    expect(r.category).toBe('food');
  });
});

describe('the thanks-for-purchase frame is retail', () => {
  // Live-QA (2026-08-28): an order confirmation with an order id and
  // "thank you for your purchase" sat uncategorised while its own shipment
  // chain was recognised. Food apps narrate the journey; they don't thank
  // you for a purchase — so the frame is a shopping signal.
  it('an order confirmation with purchase thanks lands on shopping', () => {
    const r = extract(
      {
        from: 'Perfora - Oral Care Solutions <care@perfora.in>',
        subject: 'Order #P20211168842 confirmed',
        body:
          'Order #P20211168842. Thank you for your purchase! Hi Harjot, your order has been ' +
          'confirmed and is being processed. Items: 1x Mint Fresh Toothpaste, 1x Tongue Cleaner. ' +
          'Order total: ₹517. We will notify you as soon as it ships.',
      },
      { today: TODAY },
    );
    expect(r.category).toBe('shopping');
  });
});

describe('a failed payment is not a refund', () => {
  it('a dunning notice abstains', () => {
    const r = extract(
      {
        from: 'Payments <payments@razorpay.com>',
        subject: 'Payment failed for Hostinger',
        body:
          'Hostinger ₹2500.00 Payment Failed. In case your money was debited, it will be ' +
          'automatically refunded to your original payment method within 5-7 business days. ' +
          'Please retry the payment to keep your services active.',
      },
      { today: TODAY },
    );
    expect(r.category).toBe('none');
  });
});
