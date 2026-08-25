import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extract } from '../src/index.ts';

const bills = JSON.parse(readFileSync('data/fixtures.bills.json', 'utf8'));
const commerce = JSON.parse(readFileSync('data/fixtures.commerce.json', 'utf8'));
const travel = JSON.parse(readFileSync('data/fixtures.travel.json', 'utf8'));
const shopping = JSON.parse(readFileSync('data/fixtures.shopping.json', 'utf8'));
const money = JSON.parse(readFileSync('data/fixtures.money.json', 'utf8'));
const life = JSON.parse(readFileSync('data/fixtures.life.json', 'utf8'));
const find = (f: any, id: string) => f.cases.find((c: any) => c.id === id);
const TODAY = '2026-09-15';

describe('the worked reference must reproduce exactly', () => {
  it('flight-ref matches the expected output supplied in the brief', () => {
    const c = find(commerce, 'flight-ref');
    const r = extract(c, { today: TODAY });
    expect({
      category: r.category, schemaType: r.schemaType,
      confidence: r.confidence, missing: r.missing, data: r.data,
    }).toEqual(c.expected);
  });
});

describe('marketing must not be extracted as a transaction', () => {
  it('rejects the movie-ticket blast', () => {
    const r = extract(find(commerce, 'promo-decoy'), { today: TODAY });
    expect(r.category).toBe('none');
    expect(r.schemaType).toBeNull();
    expect(r.data).toBeNull();
    expect(r.confidence).toBe('high');
    expect(r.reason).toBeTruthy();
  });

  it('rejects the bank offer that shares a domain with a real statement', () => {
    const promo = find(bills, 'promo-decoy');
    const real = find(bills, 'card-stmt');
    expect(promo.from).toContain('hdfcbank.net');
    expect(real.from).toContain('hdfcbank.net');
    expect(extract(promo, { today: TODAY }).category).toBe('none');
    expect(extract(real, { today: TODAY }).category).toBe('credit-card');
  });

  /**
   * Both supplied decoys happen to come from `offers@`. If the classifier
   * leaned on that it would score 100% here and fail on the first promo sent
   * from `no-reply@`. Stripping the sender proves the content carries it.
   */
  it('still rejects both decoys with the sender removed entirely', () => {
    for (const fixture of [bills, commerce]) {
      const decoy = find(fixture, 'promo-decoy');
      const r = extract({ subject: decoy.subject, body: decoy.body }, { today: TODAY });
      expect(r.category).toBe('none');
    }
  });

  it('still rejects a decoy sent from a transactional mailbox', () => {
    const decoy = find(commerce, 'promo-decoy');
    const r = extract({ ...decoy, from: 'BookMyShow <tickets@bookmyshow.com>' }, { today: TODAY });
    expect(r.category).toBe('none');
  });

  /**
   * The 18-category decoys, one per new fixture family. Loan and insurance
   * get the realistic Indian phishing shapes (pre-approved loan, renewal
   * cashback) since those are the categories most exposed to this failure.
   */
  it.each([
    ['travel', travel, 'travel-promo-decoy'],
    ['shopping', shopping, 'shopping-promo-decoy'],
    ['money', money, 'loan-promo-decoy'],
    ['money', money, 'insurance-promo-decoy'],
    ['life', life, 'restaurant-promo-decoy'],
  ])('rejects the %s decoy (%s)', (_family, fixture, id) => {
    const r = extract(find(fixture, id), { today: TODAY });
    expect(r.category).toBe('none');
    expect(r.data).toBeNull();
  });
});

describe('bill status is computed from the due date, not read', () => {
  const cases: Array<[string, string]> = [
    ['bill-utility', 'upcoming'],
    ['bill-due-soon', 'due-soon'],
    ['bill-overdue', 'overdue'],
  ];
  for (const [id, status] of cases) {
    it(`${id} -> ${status}`, () => {
      const r = extract(find(bills, id), { today: TODAY });
      expect(r.category).toBe('bill');
      expect((r.data as any).status).toBe(status);
    });
  }

  it('moves the same email across statuses as today moves', () => {
    const c = find(bills, 'bill-utility'); // due 2026-09-25
    expect((extract(c, { today: '2026-09-01' }).data as any).status).toBe('upcoming');
    expect((extract(c, { today: '2026-09-23' }).data as any).status).toBe('due-soon');
    expect((extract(c, { today: '2026-09-26' }).data as any).status).toBe('overdue');
  });

  it('reports status as missing when no reference date is supplied', () => {
    const r = extract(find(bills, 'bill-utility'));
    expect(r.missing).toContain('status');
    expect((r.data as any).status).toBeUndefined();
    expect(r.warnings?.join(' ')).toMatch(/reference date/i);
  });
});
