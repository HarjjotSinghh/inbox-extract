import { describe, expect, it } from 'vitest';
import { merge } from '../src/llm/fallback.ts';
import { Doc } from '../src/normalize.ts';
import { extract } from '../src/index.ts';
import type { ExtractionResult } from '../src/types.ts';

const TODAY = '2026-09-15';

/**
 * `merge` is the trust boundary: it decides which model-proposed fields become
 * data. It is a pure function of (Doc, previous result, model reply), so the
 * risky half of the LLM path is testable with no network and no API key — the
 * network only lives in `callClaude`.
 */

const abstained = (doc: Doc): ExtractionResult => ({
  category: 'none', schemaType: null, data: null, confidence: 'high', missing: [],
  reason: 'No transactional anchor found — the email carries no booking, order or tracking identifier.',
  score: 0.9, method: 'none',
});

describe('a model cannot invent a field', () => {
  const doc = new Doc({
    from: 'Acme Travel <no-reply@acme.example>',
    subject: 'Itinerary',
    body: 'Locator X4K9P2, carrier flight AI 302 from Delhi (DEL) to Mumbai (BOM).',
  });

  it('rejects a value that is not present on token boundaries in its quote', () => {
    const r = merge(doc, abstained(doc), {
      category: 'flight',
      fields: [
        { name: 'reservationId', value: 'X4K9P2', quote: 'Locator X4K9P2' },
        { name: 'flightNumber', value: 'AI 302', quote: 'carrier flight AI 302' },
        { name: 'seat', value: '4K9', quote: 'Locator X4K9P2' }, // a slice of the locator
      ],
    });
    expect((r.data as any)?.reservationId).toBe('X4K9P2');
    expect((r.data as any)?.seat).toBeUndefined();
    expect(r.warnings?.join(' ')).toMatch(/seat/);
  });

  it('rejects a field whose quote does not appear in the email at all', () => {
    const r = merge(doc, abstained(doc), {
      category: 'flight',
      fields: [
        { name: 'reservationId', value: 'X4K9P2', quote: 'Locator X4K9P2' },
        { name: 'flightNumber', value: 'AI 302', quote: 'carrier flight AI 302' },
        { name: 'airline', value: 'Emirates', quote: 'operated by Emirates' },
      ],
    });
    expect((r.data as any)?.airline).toBeUndefined();
  });

  it('does not throw when the model returns a non-string where a string was requested', () => {
    expect(() => merge(doc, abstained(doc), {
      category: 'flight',
      fields: [
        { name: 'seat', value: 12 as never, quote: 'Locator' },
        { name: 'reservationId', value: 'X4K9P2', quote: 4711 as never },
      ],
    })).not.toThrow();
  });
});

describe('a model cannot talk the extractor out of an abstention', () => {
  it('keeps the abstention when no grounded identifier is produced', () => {
    const doc = new Doc({
      from: 'BookMyShow Offers <offers@bookmyshow.com>',
      subject: 'Flat 50% off movie tickets this weekend!',
      body: 'Book any movie this weekend and get 50% off! Use code WEEKEND50. T&C apply.',
    });
    const r = merge(doc, abstained(doc), {
      category: 'event',
      fields: [{ name: 'eventName', value: 'movie', quote: 'Book any movie' }],
    });
    expect(r.category).toBe('none');
    expect(r.warnings?.join(' ')).toMatch(/abstention kept/i);
  });

  it('clears the abstention rationale when a promotion does happen', () => {
    const doc = new Doc({
      from: 'Acme Travel <no-reply@acme.example>',
      subject: 'Itinerary',
      body: 'Locator X4K9P2, carrier flight AI 302 from Delhi (DEL) to Mumbai (BOM).',
    });
    const r = merge(doc, abstained(doc), {
      category: 'flight',
      fields: [
        { name: 'reservationId', value: 'X4K9P2', quote: 'Locator X4K9P2' },
        { name: 'flightNumber', value: 'AI 302', quote: 'carrier flight AI 302' },
      ],
    });
    expect(r.category).toBe('flight');
    // A result that is no longer an abstention must not carry one's reasoning.
    expect(r.reason).toBeUndefined();
  });
});

describe('adding information never lowers confidence beyond the method penalty', () => {
  it('does not deflate a subscription that already had its anchor', () => {
    const email = {
      from: 'Netflix <info@netflix.com>',
      subject: 'Your Netflix membership will renew soon',
      body: 'Hi, your Netflix Premium plan will renew on 22 Sep 2026. You will be charged ₹649 to the card ending 4821.',
    };
    const base = extract(email, { today: TODAY });
    expect(base.category).toBe('subscription');

    const after = merge(new Doc(email), base, {
      category: 'subscription',
      fields: [{ name: 'paymentMethod', value: 'card ending 4821', quote: 'the card ending 4821' }],
    });

    // Only the deliberate `method: 'llm'` trust penalty should apply. An earlier
    // version re-derived the anchor from a list that no subscription field could
    // satisfy, so gaining a field cost ~0.21 of confidence.
    expect((base.score ?? 0) - (after.score ?? 0)).toBeLessThan(0.06);
  });
});
