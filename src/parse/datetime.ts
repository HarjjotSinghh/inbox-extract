import type { Span } from './money.ts';

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_WORD =
  '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const DOW = '(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\\.?,?\\s*';
const TIME_TAIL = '(?:[,\\s]+(?:at\\s+)?(\\d{1,2}):(\\d{2})\\s*(am|pm|a\\.m\\.|p\\.m\\.)?)?';

export type DateKind = 'datetime' | 'date' | 'time';

export interface DateHit {
  /** "2026-09-20T18:30" | "2026-09-20" | "18:30" */
  value: string;
  kind: DateKind;
  /** True when a numeric d/m/y could equally be m/d/y. Callers downgrade confidence. */
  ambiguous?: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function to24h(hour: number, minute: number, meridiem?: string | null): string | null {
  let h = hour;
  const mer = meridiem?.replace(/\./g, '').toLowerCase();
  if (mer === 'pm' && h < 12) h += 12;
  if (mer === 'am' && h === 12) h = 0;
  if (h < 0 || h > 23 || minute < 0 || minute > 59) return null;
  return `${pad(h)}:${pad(minute)}`;
}

function ymd(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function build(date: string | null, time: string | null): DateHit | null {
  if (date && time) return { value: `${date}T${time}`, kind: 'datetime' };
  if (date) return { value: date, kind: 'date' };
  if (time) return { value: time, kind: 'time' };
  return null;
}

type Rule = { re: RegExp; read: (m: RegExpExecArray) => DateHit | null };

const RULES: Rule[] = [
  // 20 Sep 2026 [, 6:30 PM]  — the dominant Indian/EU transactional form
  {
    re: new RegExp(`(?:${DOW})?(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_WORD}\\s*,?\\s*(\\d{4})${TIME_TAIL}`, 'i'),
    read: (m) => {
      const month = MONTHS[(m[2] ?? '').toLowerCase()];
      if (!month) return null;
      const date = ymd(Number(m[3]), month, Number(m[1]));
      const time = m[4] ? to24h(Number(m[4]), Number(m[5]), m[6]) : null;
      return build(date, time);
    },
  },
  // Sep 20, 2026 [, 6:30 PM]
  {
    re: new RegExp(`(?:${DOW})?${MONTH_WORD}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s*(\\d{4})${TIME_TAIL}`, 'i'),
    read: (m) => {
      const month = MONTHS[(m[1] ?? '').toLowerCase()];
      if (!month) return null;
      const date = ymd(Number(m[3]), month, Number(m[2]));
      const time = m[4] ? to24h(Number(m[4]), Number(m[5]), m[6]) : null;
      return build(date, time);
    },
  },
  // 2026-09-20[T18:30]
  {
    re: /(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/,
    read: (m) => {
      const date = ymd(Number(m[1]), Number(m[2]), Number(m[3]));
      const time = m[4] ? to24h(Number(m[4]), Number(m[5]), null) : null;
      return build(date, time);
    },
  },
  // 20/09/2026 — genuinely ambiguous unless one component exceeds 12.
  {
    re: /(\d{1,2})[/.](\d{1,2})[/.](\d{4})/,
    read: (m) => {
      const a = Number(m[1]);
      const b = Number(m[2]);
      const y = Number(m[3]);
      if (a > 12 && b <= 12) return wrap(ymd(y, b, a), false);
      if (b > 12 && a <= 12) return wrap(ymd(y, a, b), false);
      // Both plausible. Emit day-first (dominant outside the US) but flag it,
      // so the caller can downgrade confidence instead of silently guessing.
      return wrap(ymd(y, b, a), true);
    },
  },
  // Bare clock time: "8:45 PM", "08:15"
  {
    re: /\b(\d{1,2}):(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?\b/i,
    read: (m) => build(null, to24h(Number(m[1]), Number(m[2]), m[3])),
  },
];

function wrap(date: string | null, ambiguous: boolean): DateHit | null {
  if (!date) return null;
  return { value: date, kind: 'date', ambiguous };
}

/** First date-ish span in `text`, preferring the most complete interpretation. */
export function findDateTime(text: string): Span<DateHit> | null {
  let best: Span<DateHit> | null = null;
  for (const rule of RULES) {
    const m = rule.re.exec(text);
    if (!m || m.index == null) continue;
    const hit = rule.read(m);
    if (!hit) continue;
    const span: Span<DateHit> = { value: hit, index: m.index, length: m[0].length };
    // Rules are ordered by specificity; a full date always beats a bare time.
    if (!best || rank(hit.kind) > rank(best.value.kind)) best = span;
    if (best.value.kind === 'datetime') break;
  }
  return best;
}

function rank(kind: DateKind): number {
  return kind === 'datetime' ? 3 : kind === 'date' ? 2 : 1;
}

/** Attach a clock time found elsewhere in the email to an already-known date. */
export function combine(date: string, time: string): string {
  return `${date}T${time}`;
}

export function daysBetween(fromISO: string, toISO: string): number | null {
  const a = Date.parse(`${fromISO.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${toISO.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

