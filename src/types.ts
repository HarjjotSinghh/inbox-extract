/**
 * Core contract.
 *
 * The five keys required by the brief are `category`, `schemaType`, `data`,
 * `confidence`, `missing`. Everything after them is additive: it exists so the
 * result can be audited, scored, and rendered without re-running the extractor.
 */

export type Confidence = 'high' | 'medium' | 'low';

export type Category =
  | 'flight'
  | 'train'
  | 'bus'
  | 'hotel'
  | 'cab'
  | 'food'
  | 'shopping'
  | 'subscription'
  | 'event'
  | 'refund'
  | 'medical'
  | 'credit-card'
  | 'bill'
  | 'shipment'
  | 'loan'
  | 'insurance'
  | 'salary'
  | 'restaurant'
  | 'none';

/** Where a value was read from. Used by the grounding check to pick the haystack. */
export type SourceKind = 'text' | 'sender' | 'jsonld' | 'microdata' | 'llm';

/** How a value was produced. `derived` values are normalisations of a quote, never inventions. */
export type Method = 'jsonld' | 'microdata' | 'rules' | 'llm' | 'none';

export interface Email {
  id?: string;
  from?: string;
  to?: string;
  subject?: string;
  /** Plain text or HTML. HTML is detected and stripped during normalisation. */
  body?: string;
  html?: string;
  /**
   * ISO timestamp the message was received. Used ONLY to resolve otherwise
   * unresolvable partial dates ("8:45 PM"). Never fabricated when absent.
   */
  date?: string;
}

export interface Money {
  amount: number;
  /** ISO-4217 where determinable from the symbol/code in the email. */
  currency: string;
  /** The exact substring the amount was read from. */
  raw: string;
}

export interface LineItem {
  name: string;
  quantity?: number;
  price?: Money;
}

/**
 * Proof that a field came from the email. `quote` must be a verbatim substring
 * of the named source; `value` must be recoverable from `quote` by a registered
 * normaliser. Fields that fail this check are dropped, never emitted.
 */
export interface Provenance {
  source: SourceKind;
  quote: string;
  start: number;
  end: number;
  /** Identifier of the rule that fired, for debugging and rule-level metrics. */
  rule: string;
  /**
   * True when `value` is a normalisation of `quote` rather than a copy of it
   * (an ISO date from "20 Sep 2026", a number from "₹18,450.00").
   * The quote must still exist verbatim in the source either way.
   */
  derived?: boolean;
}

export interface ExtractionResult {
  // --- required by the brief ---
  category: Category;
  schemaType: string | null;
  data: Record<string, unknown> | null;
  confidence: Confidence;
  missing: string[];

  // --- additive ---
  /** Fields found but under-specified (e.g. a time with no resolvable date). */
  partial?: string[];
  /** Why we abstained, present whenever category is 'none'. */
  reason?: string;
  /** Numeric confidence in [0,1]; `confidence` is this bucketed. */
  score?: number;
  /** field -> proof. Every key here is also a key in `data`. */
  provenance?: Record<string, Provenance>;
  /** Ranked classifier output, for debugging near-misses. */
  signals?: Array<{ category: Category; score: number }>;
  method?: Method;
  /** Non-fatal disagreements, e.g. stated status vs computed status. */
  warnings?: string[];
  /** Per-field explanation for anything listed in `partial`. */
  notes?: Record<string, string>;
}

export interface ExtractOptions {
  /**
   * Reference date for status maths (upcoming / due-soon / overdue).
   * Explicit so runs are reproducible; falls back to system date with a warning.
   */
  today?: string;
  /** Days-until-due at or below which a bill is 'due-soon'. */
  dueSoonDays?: number;
  /** Enable the unknown-sender LLM fallback. Off by default. */
  llm?: boolean;
  llmApiKey?: string;
  llmModel?: string;
}

export type BillStatus = 'upcoming' | 'due-soon' | 'overdue';
