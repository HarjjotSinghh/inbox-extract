import type { Doc, Found } from '../normalize.ts';
import type { Category, Provenance } from '../types.ts';

export interface ExtractorContext {
  doc: Doc;
  /** Reference date for status maths. null when the caller did not supply one. */
  today: string | null;
  dueSoonDays: number;
}

export interface ExtractorOutput {
  data: Record<string, unknown>;
  provenance: Record<string, Provenance>;
  missing: string[];
  partial: string[];
  warnings: string[];
  notes: Record<string, string>;
  /**
   * A category-defining identifier was found verbatim (PNR, booking id,
   * tracking id, card last-4...). Strong anchors are what separate a real
   * booking from a blast that merely talks about bookings.
   */
  anchorStrong: boolean;
  /** Enough evidence to build a usable card, even without a hard identifier. */
  anchorSatisfied: boolean;
  requiredFound: number;
  requiredTotal: number;
}

export interface Extractor {
  category: Exclude<Category, 'none'>;
  schemaType: string;
  /** Absent required fields are reported in `missing`, never invented. */
  required: readonly string[];
  run(ctx: ExtractorContext): ExtractorOutput | null;
}

/**
 * Accumulates fields and their proof together.
 *
 * There is deliberately no way to write a field without a `Found` or an
 * explicit derivation from one — that is the structural half of "never invent
 * a field", with `ground.ts` verifying the other half.
 */
export class Draft {
  readonly data: Record<string, unknown> = {};
  readonly provenance: Record<string, Provenance> = {};
  readonly partial: string[] = [];
  readonly warnings: string[] = [];
  readonly notes: Record<string, string> = {};

  set<T>(field: string, f: Found<T> | null | undefined): T | null {
    if (!f || f.value == null || f.value === '') return null;
    this.data[field] = f.value;
    this.provenance[field] = {
      source: f.source,
      quote: f.quote,
      start: f.start,
      end: f.end,
      rule: f.rule,
    };
    return f.value;
  }

  /**
   * Record a value computed from an already-grounded span — an ISO date from
   * "20 Sep 2026", a bill status from a due date. The quote still points at
   * real text; only the representation changed.
   */
  derive<T>(field: string, value: T | null | undefined, from: Found<unknown> | null, rule: string): T | null {
    if (value == null || value === '' || !from) return null;
    this.data[field] = value;
    this.provenance[field] = {
      source: from.source,
      quote: from.quote,
      start: from.start,
      end: from.end,
      rule: `${from.rule}>${rule}`,
      derived: true,
    };
    return value;
  }

  /** Found, but not fully specified. Emitted with a note rather than completed by guessing. */
  markPartial(field: string, why: string): void {
    if (!this.partial.includes(field)) this.partial.push(field);
    this.notes[field] = why;
  }

  warn(message: string): void {
    if (!this.warnings.includes(message)) this.warnings.push(message);
  }

  has(field: string): boolean {
    return Object.hasOwn(this.data, field);
  }

  missingFrom(required: readonly string[]): string[] {
    return required.filter((f) => !this.has(f));
  }

  finish(opts: {
    required: readonly string[];
    anchorStrong: boolean;
    anchorSatisfied?: boolean;
  }): ExtractorOutput {
    const missing = this.missingFrom(opts.required);
    return {
      data: this.data,
      provenance: this.provenance,
      missing,
      partial: this.partial,
      warnings: this.warnings,
      notes: this.notes,
      anchorStrong: opts.anchorStrong,
      anchorSatisfied: opts.anchorSatisfied ?? (opts.anchorStrong || missing.length < opts.required.length),
      requiredFound: opts.required.length - missing.length,
      requiredTotal: opts.required.length,
    };
  }
}

/** Sender display name, used as a fallback for merchant/issuer/biller. */
export function senderBrand(doc: Doc, rule: string): Found<string> | null {
  const name = doc.sender.displayName;
  if (!name) return null;
  const cleaned = name.replace(/\s+(?:offers?|deals?|team|support|alerts?|notifications?)$/i, '').trim();
  if (!cleaned) return null;
  const start = doc.sender.raw.indexOf(cleaned);
  if (start < 0) return null;
  return { value: cleaned, quote: cleaned, start, end: start + cleaned.length, source: 'sender', rule };
}
