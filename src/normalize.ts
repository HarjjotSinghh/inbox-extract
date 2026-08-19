import type { Email, SourceKind } from './types.ts';

/**
 * A value plus the exact span it was read from.
 *
 * Nothing reaches `data` without one of these. `quote` is a verbatim substring
 * of the source identified by `source`; `start`/`end` index into that source.
 */
export interface Found<T> {
  value: T;
  quote: string;
  start: number;
  end: number;
  source: SourceKind;
  rule: string;
}

export function found<T>(
  value: T,
  quote: string,
  start: number,
  rule: string,
  source: SourceKind = 'text',
): Found<T> {
  return { value, quote, start, end: start + quote.length, source, rule };
}

export interface Sender {
  raw: string;
  displayName: string | null;
  address: string | null;
  localPart: string | null;
  domain: string | null;
  /** Registrable-ish domain with common ccSLDs folded (amazon.in -> amazon). */
  brandToken: string | null;
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  ndash: '–', mdash: '—', hellip: '…', middot: '·',
  rupee: '₹', eacute: 'é', deg: '°', times: '×',
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[String(name).toLowerCase()] ?? m);
}

function safeChar(code: number): string {
  return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
}

const LOOKS_LIKE_HTML = /<\s*(?:html|body|div|table|p|br|span|a|td|tr|script|style)\b/i;

export function isHtml(s: string): boolean {
  return LOOKS_LIKE_HTML.test(s);
}

/** Strip tags to readable text while keeping block boundaries as newlines. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\s*br\s*\/?\s*>/gi, '\n')
      .replace(/<\s*\/\s*(?:p|div|tr|table|li|h[1-6]|section|header|footer)\s*>/gi, '\n')
      .replace(/<\s*\/\s*t[dh]\s*>/gi, '\t')
      .replace(/<[^>]+>/g, ' '),
  );
}

/** Collapse runs of horizontal whitespace; keep at most one blank line. */
export function collapse(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t   ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Layer 0: real schema.org markup, which is what Gmail actually reads.
 * Fixtures are plain text, but any production inbox has senders who ship this,
 * and trusting it is strictly better than re-deriving it from prose.
 */
export function extractJsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    const raw = m[1];
    if (!raw) continue;
    try {
      const parsed: unknown = JSON.parse(decodeEntities(raw.trim()));
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch {
      // Malformed markup is common in the wild; ignore and fall through to text rules.
    }
  }
  return out;
}

const CC_SLD = new Set(['co', 'com', 'net', 'org', 'gov', 'ac', 'edu']);

export function parseSender(raw: string | undefined): Sender {
  const text = (raw ?? '').trim();
  const empty: Sender = {
    raw: text, displayName: null, address: null, localPart: null, domain: null, brandToken: null,
  };
  if (!text) return empty;

  const angled = /^\s*(.*?)\s*<\s*([^>]+?)\s*>\s*$/.exec(text);
  const display = angled ? stripQuotes(angled[1] ?? '') : null;
  const address = (angled ? angled[2] : /@/.test(text) ? text : null)?.trim().toLowerCase() ?? null;

  if (!address || !address.includes('@')) {
    return { ...empty, displayName: display || (text || null) };
  }
  const at = address.lastIndexOf('@');
  const localPart = address.slice(0, at);
  const domain = address.slice(at + 1);
  const labels = domain.split('.').filter(Boolean);
  let brand: string | null = labels[0] ?? null;
  if (labels.length >= 2) {
    const last = labels[labels.length - 1] ?? '';
    const secondLast = labels[labels.length - 2] ?? '';
    brand = last.length === 2 && CC_SLD.has(secondLast) && labels.length >= 3
      ? (labels[labels.length - 3] ?? secondLast)
      : secondLast;
  }
  return {
    raw: text,
    displayName: display && display.length ? display : null,
    address,
    localPart,
    domain,
    brandToken: brand,
  };
}

function stripQuotes(s: string): string {
  return s.replace(/^["'“‘]+|["'”’]+$/g, '').trim();
}

/**
 * Normalised, offset-stable view of one email.
 *
 * `text` is the single haystack every text rule searches and every provenance
 * offset indexes into: subject first (subject lines carry the strongest signal),
 * then body.
 */
/** Coerce anything a mail store might hand us into a string we can scan. */
function asText(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';
}

export class Doc {
  readonly email: Email;
  readonly subject: string;
  readonly body: string;
  readonly text: string;
  readonly sender: Sender;
  readonly jsonld: unknown[];
  readonly bodyOffset: number;

  constructor(email: Email) {
    // Callers pass whatever their mail store handed them; a null message or a
    // numeric body should abstain, not throw.
    const safe: Email = email && typeof email === 'object' ? email : {};
    this.email = safe;
    const rawBody = asText(safe.html) || asText(safe.body);
    const jsonld = rawBody && isHtml(rawBody) ? extractJsonLd(rawBody) : [];
    const bodyText = collapse(rawBody && isHtml(rawBody) ? htmlToText(rawBody) : rawBody);
    const subject = collapse(decodeEntities(asText(safe.subject)));

    this.subject = subject;
    this.body = bodyText;
    this.text = subject ? `${subject}\n\n${bodyText}` : bodyText;
    this.bodyOffset = subject ? subject.length + 2 : 0;
    this.sender = parseSender(asText(safe.from));
    this.jsonld = jsonld;
  }


  private haystack(source: SourceKind): string {
    return source === 'sender' ? this.sender.raw : this.text;
  }

  /**
   * Run a regex and return the chosen capture group with absolute offsets.
   * Offsets always describe the group, not the whole match, so provenance stays tight.
   */
  match(rule: string, re: RegExp, group = 1, source: SourceKind = 'text'): Found<string> | null {
    const hay = this.haystack(source);
    const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
    for (const m of hay.matchAll(new RegExp(re.source, flags))) {
      const whole = m[0];
      const picked = m[group];
      if (picked == null || m.index == null) continue;
      const rel = whole.indexOf(picked);
      const start = m.index + (rel >= 0 ? rel : 0);
      return found(picked, picked, start, rule, source);
    }
    return null;
  }

  matchAll(rule: string, re: RegExp, group = 1, source: SourceKind = 'text'): Array<Found<string>> {
    const hay = this.haystack(source);
    const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
    const out: Array<Found<string>> = [];
    for (const m of hay.matchAll(new RegExp(re.source, flags))) {
      const whole = m[0];
      const picked = m[group];
      if (picked == null || m.index == null) continue;
      const rel = whole.indexOf(picked);
      out.push(found(picked, picked, m.index + (rel >= 0 ? rel : 0), rule, source));
    }
    return out;
  }

  has(re: RegExp): boolean {
    return re.test(this.text);
  }

}
