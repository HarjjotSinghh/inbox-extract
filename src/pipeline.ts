import { CANDIDATE_FLOOR, classify, type CategoryScore } from './classify.ts';
import { scoreAbstention, scoreResult } from './confidence.ts';
import type { ExtractorContext, ExtractorOutput } from './extractors/base.ts';
import { hasAnchor } from './extractors/base.ts';
import { extractorFor } from './extractors/registry.ts';
import { ground } from './ground.ts';
import { readJsonLd } from './jsonld.ts';
import { Doc } from './normalize.ts';
import { DEFAULT_DUE_SOON_DAYS } from './status.ts';
import type { Email, ExtractOptions, ExtractionResult, Method } from './types.ts';

/**
 * How many classifier candidates actually get an extractor run. Sized for the
 * largest collision family (travel: flight/train/bus/hotel/cab share PNR and
 * booking-id vocabulary) plus headroom — extraction disposes, not the
 * classifier, so a true category outside the top 3 must still get a chance
 * to prove its anchor.
 */
const MAX_CANDIDATES = 6;
/** Promo score above which a result without a hard identifier is rejected. */
const PROMO_VETO = 0.6;
/**
 * Above this, the email reads as an inducement even though an extractor found
 * its anchor — "Pay ₹799 before 30 Sep and enjoy double data" carries an
 * amount, a date and a subscriber number, and is still not a bill. Showing a
 * fabricated bill in a bills-due surface is worse than missing a real one.
 */
const PROMO_HARD_VETO = 0.85;

interface Attempt {
  candidate: CategoryScore;
  output: ExtractorOutput;
  /** Evaluated against the data that survived grounding, not before it. */
  anchorStrong: boolean;
  droppedCount: number;
  decision: number;
}

/**
 * Extract one email.
 *
 * Classification proposes; extraction disposes. A category is only assigned if
 * its own extractor can find the fields that define it, which is what makes
 * "Flat 50% off movie tickets" fall through to 'none' — it talks like a
 * booking but has no booking in it.
 */
export function extract(email: Email, options: ExtractOptions = {}): ExtractionResult {
  const doc = new Doc(email);
  const today = options.today ?? null;
  const ctx: ExtractorContext = {
    doc,
    today,
    dueSoonDays: options.dueSoonDays ?? DEFAULT_DUE_SOON_DAYS,
  };

  if (!doc.text.trim()) {
    return {
      category: 'none', schemaType: null, data: null, confidence: 'low', missing: [],
      reason: 'Email has no subject or body content to read.', score: 0.3, method: 'none',
    };
  }

  const { ranked, promo } = classify(doc);

  // Layer 0: the sender already published structured data. Trust it, then let
  // the text rules fill any gaps it left.
  const seed = readJsonLd(doc.jsonld);
  if (seed && seed.category !== 'none') {
    return buildFromSeed(doc, ctx, seed, ranked, promo.score);
  }

  const candidates = ranked.filter((r) => r.raw >= CANDIDATE_FLOOR).slice(0, MAX_CANDIDATES);
  const attempts: Attempt[] = [];

  const tryCandidate = (candidate: CategoryScore): Attempt | null => {
    const extractor = extractorFor(candidate.category);
    if (!extractor) return null;
    const output = extractor.run(ctx);
    if (!output) return null;

    const report = ground(doc, output.data, output.provenance);
    // Grounding can delete fields, so everything derived from `data` — the
    // missing list and both anchors — is computed after the check, not before.
    const missing = extractor.required.filter((f) => !Object.hasOwn(output.data, f));
    const requiredFound = extractor.required.length - missing.length;
    output.missing = missing;

    if (!hasAnchor(output.data, extractor.softAnchor)) return null;
    const anchorStrong = hasAnchor(output.data, extractor.strongAnchor);

    return {
      candidate,
      output: { ...output, requiredFound },
      anchorStrong,
      droppedCount: report.dropped.length,
      decision: candidate.score + (anchorStrong ? 1 : 0.35) + requiredFound * 0.05,
    };
  };

  for (const candidate of candidates) {
    const attempt = tryCandidate(candidate);
    if (attempt) attempts.push(attempt);
  }

  attempts.sort((a, b) => b.decision - a.decision);
  let best = attempts[0];

  if (!best) return abstain(ranked, promo.score, promo.promoHits, 'no-anchor');

  // Same deferral buildFromSeed applies to JSON-LD Orders: 'food' strong-anchors
  // on a bare order id, which any retail parcel also carries. When the wording
  // itself CLEARLY ranked a parcel category above food, the food win is the
  // anchor bonus talking, not the email — hand the verdict to a parcel attempt,
  // running one on the spot if the candidate cut excluded it. The 1.2× margin
  // matters: a Blinkit grocery run ("dispatched", "arriving in 9 minutes")
  // edges food on raw wording by a hair, and a hair is not a reason to
  // overrule an anchored food order.
  const PARCEL_DEFERRAL_MARGIN = 1.2;
  if (best.candidate.category === 'food') {
    const bar = best.candidate.raw * PARCEL_DEFERRAL_MARGIN;
    let parcel =
      attempts.find(
        (a) =>
          (a.candidate.category === 'shopping' || a.candidate.category === 'shipment') &&
          a.candidate.raw > bar,
      ) ?? null;
    if (!parcel) {
      for (const r of ranked) {
        if ((r.category === 'shopping' || r.category === 'shipment') && r.raw > bar) {
          parcel = tryCandidate(r);
          if (parcel) break;
        }
      }
    }
    if (parcel) best = parcel;
  }

  // A blast can occasionally satisfy a soft anchor. A hard identifier is the
  // one thing marketing never carries, so it is what overrides a promo verdict —
  // up to the point where the offer framing is overwhelming, which no amount of
  // anchor rescues.
  if (promo.score >= PROMO_HARD_VETO || (promo.score >= PROMO_VETO && !best.anchorStrong)) {
    return abstain(ranked, promo.score, promo.promoHits, 'promo-veto');
  }

  return assemble(best, promo.score, 'rules', ranked);
}

function assemble(best: Attempt, promoScore: number, method: Method, ranked: CategoryScore[]): ExtractionResult {
  const extractor = extractorFor(best.candidate.category);
  const { score, confidence } = scoreResult({
    lexical: best.candidate.score,
    anchorStrong: best.anchorStrong,
    requiredFound: best.output.requiredFound,
    requiredTotal: best.output.requiredTotal,
    promoScore,
    partialCount: best.output.partial.length,
    droppedCount: best.droppedCount,
    method,
  });

  return {
    category: best.candidate.category,
    schemaType: extractor?.schemaType ?? null,
    data: best.output.data,
    confidence,
    missing: best.output.missing,
    ...(best.output.partial.length ? { partial: best.output.partial } : {}),
    score,
    provenance: best.output.provenance,
    signals: ranked.slice(0, 4).map((r) => ({ category: r.category, score: Number(r.score.toFixed(3)) })),
    method,
    ...(best.output.warnings.length ? { warnings: best.output.warnings } : {}),
    ...(Object.keys(best.output.notes).length ? { notes: best.output.notes } : {}),
  };
}

function buildFromSeed(
  doc: Doc,
  ctx: ExtractorContext,
  seed: NonNullable<ReturnType<typeof readJsonLd>>,
  ranked: CategoryScore[],
  promoScore: number,
): ExtractionResult {
  // schema.org's Order has no food-vs-retail split, so jsonld.ts always seeds
  // 'food' for it. Defer to the classifier's own text signals — already
  // computed, already passed in — when they clearly favour 'shopping' instead.
  const category = seed.category === 'food' && (ranked.find((r) => r.category === 'shopping')?.raw ?? 0)
      > (ranked.find((r) => r.category === 'food')?.raw ?? 0)
    ? 'shopping'
    : seed.category;

  const extractor = extractorFor(category);
  const fromText = extractor?.run(ctx) ?? null;
  if (fromText) ground(doc, fromText.data, fromText.provenance);

  const data = { ...(fromText?.data ?? {}), ...seed.data };
  const provenance = { ...(fromText?.provenance ?? {}), ...seed.provenance };
  const required = extractor?.required ?? [];
  const missing = required.filter((f) => !Object.hasOwn(data, f));

  const { score, confidence } = scoreResult({
    lexical: ranked[0]?.score ?? 0.5,
    anchorStrong: true,
    requiredFound: required.length - missing.length,
    requiredTotal: required.length,
    promoScore,
    partialCount: fromText?.partial.length ?? 0,
    droppedCount: 0,
    method: 'jsonld',
  });

  return {
    category,
    schemaType: seed.schemaType,
    data,
    confidence,
    missing,
    ...(fromText?.partial.length ? { partial: fromText.partial } : {}),
    score,
    provenance,
    signals: ranked.slice(0, 4).map((r) => ({ category: r.category, score: Number(r.score.toFixed(3)) })),
    method: 'jsonld',
    ...(fromText?.warnings.length ? { warnings: fromText.warnings } : {}),
    ...(fromText && Object.keys(fromText.notes).length ? { notes: fromText.notes } : {}),
  };
}

function abstain(
  ranked: CategoryScore[],
  promoScore: number,
  promoHits: string[],
  cause: 'no-anchor' | 'promo-veto',
): ExtractionResult {
  const top = ranked[0];
  const { score, confidence } = scoreAbstention(promoScore, Boolean(top));

  const promoPart = promoHits.length
    ? `Marketing markers present (${promoHits.slice(0, 5).join(', ')}). `
    : '';
  const nearest = top
    ? `Closest category was '${top.category}' on wording alone (${top.score.toFixed(2)}), but its identifying fields are absent.`
    : 'No category signals matched.';
  const reason =
    cause === 'promo-veto'
      ? `${promoPart}Reads as an offer, and no hard identifier (booking / order / tracking / statement number) is present, so nothing here is a record of a transaction.`
      : `${promoPart}No transactional anchor found — the email carries no booking, order, tracking, appointment or statement identifier, and no amount tied to a due date. ${nearest}`;

  return {
    category: 'none',
    schemaType: null,
    data: null,
    confidence,
    missing: [],
    reason,
    score,
    signals: ranked.slice(0, 4).map((r) => ({ category: r.category, score: Number(r.score.toFixed(3)) })),
    method: 'none',
  };
}
