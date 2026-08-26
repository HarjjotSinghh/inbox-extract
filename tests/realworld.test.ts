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
