import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Doc, extract, ground } from '../src/index.ts';
import type { Provenance } from '../src/types.ts';

describe('grounding drops anything not present in the email', () => {
  const email = { from: 'Acme <no-reply@acme.com>', subject: 'Order shipped', body: 'Tracking ID: AC998877. Your order #A-1 has shipped.' };

  it('deletes a field whose quote does not appear in the source', () => {
    const doc = new Doc(email);
    const data: Record<string, unknown> = { trackingId: 'AC998877', carrier: 'Blue Dart' };
    const provenance: Record<string, Provenance> = {
      trackingId: { source: 'text', quote: 'AC998877', start: doc.text.indexOf('AC998877'), end: doc.text.indexOf('AC998877') + 8, rule: 'test' },
      carrier: { source: 'text', quote: 'shipped via Blue Dart', start: 0, end: 21, rule: 'test' },
    };

    const report = ground(doc, data, provenance);
    expect(data.trackingId).toBe('AC998877');
    expect(data.carrier).toBeUndefined();
    expect(report.dropped.map((d) => d.field)).toEqual(['carrier']);
  });

  it('deletes a field whose value is not contained in its own quote', () => {
    const doc = new Doc(email);
    const at = doc.text.indexOf('AC998877');
    const data: Record<string, unknown> = { carrier: 'Delhivery' };
    const provenance: Record<string, Provenance> = {
      carrier: { source: 'text', quote: 'AC998877', start: at, end: at + 8, rule: 'test' },
    };
    ground(doc, data, provenance);
    expect(data.carrier).toBeUndefined();
  });

  it('every field emitted on every fixture carries a quote found in that email', () => {
    // Previously this asserted against a single hardcoded email while claiming
    // fixture-wide coverage. It now actually reads the fixtures.
    const files = ['data/fixtures.bills.json', 'data/fixtures.commerce.json'];
    let checked = 0;
    for (const file of files) {
      const fixture = JSON.parse(readFileSync(file, 'utf8')) as { cases: any[] };
      for (const c of fixture.cases) {
        const r = extract(c, { today: '2026-09-15' });
        const haystack = `${c.from ?? ''}\n${c.subject ?? ''}\n${c.body ?? ''}`.replace(/\s+/g, ' ');
        for (const [field, p] of Object.entries(r.provenance ?? {})) {
          expect(haystack.includes(p.quote.replace(/\s+/g, ' ')), `${c.id}.${field}: ${p.quote}`).toBe(true);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(60);
  });
});

describe('absent fields are reported, never filled in', () => {
  it('a bill with no due date reports dueDate and status missing', () => {
    const r = extract({
      from: 'BESCOM <no-reply@bescom.co.in>',
      subject: 'Your electricity bill is ready',
      body: 'Your electricity bill for account 771122 is ready. Amount: ₹1,200.',
    }, { today: '2026-09-15' });

    expect(r.category).toBe('bill');
    expect(r.missing).toEqual(expect.arrayContaining(['dueDate', 'status']));
    expect((r.data as any).dueDate).toBeUndefined();
    expect((r.data as any).amount).toMatchObject({ amount: 1200, currency: 'INR' });
    expect(r.confidence).not.toBe('high');
  });

  it('a delivery time with no date stays a time and is flagged partial', () => {
    const r = extract({
      from: 'Zomato <orders@zomato.com>',
      subject: 'Your order is on the way — Order #ZO987654',
      body: "Your order from Meghana Foods is on the way! Order #ZO987654. Items: 1x Chicken Biryani (₹320). Total: ₹320. Estimated delivery: 8:45 PM.",
    }, { today: '2026-09-15' });

    expect((r.data as any).eta).toBe('20:45');
    expect(r.partial).toContain('eta');
    expect(String((r.data as any).eta)).not.toMatch(/2026/);
  });

  it('does not read a nested label out of a longer one', () => {
    const r = extract({
      from: 'HDFC Bank <cards@hdfcbank.net>',
      subject: 'Your HDFC Bank Credit Card statement',
      body: 'Card ending 4821. Total amount due: ₹18,450.00. Payment due date: 20 Sep 2026. Available credit limit: ₹1,81,550.',
    }, { today: '2026-09-15' });

    // "Available credit limit" must not also yield a `creditLimit` field.
    expect((r.data as any).availableCredit).toMatchObject({ amount: 181550 });
    expect((r.data as any).creditLimit).toBeUndefined();
  });
});
