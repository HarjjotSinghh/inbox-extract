import type { Confidence, Method } from './types.ts';

export interface ConfidenceInput {
  /** Classifier agreement, 0..1. */
  lexical: number;
  anchorStrong: boolean;
  requiredFound: number;
  requiredTotal: number;
  promoScore: number;
  partialCount: number;
  droppedCount: number;
  method: Method;
}

const METHOD_TRUST: Record<Method, number> = {
  jsonld: 1, microdata: 0.95, rules: 0.8, llm: 0.45, none: 0.2,
};

export function bucket(score: number): Confidence {
  if (score >= 0.75) return 'high';
  if (score >= 0.5) return 'medium';
  return 'low';
}

/**
 * Confidence is about the *result*, not the classifier: coverage of the fields
 * the schema declares matters more than how many keywords matched.
 */
export function scoreResult(i: ConfidenceInput): { score: number; confidence: Confidence } {
  const coverage = i.requiredTotal > 0 ? i.requiredFound / i.requiredTotal : 0;

  let score =
    0.25 * i.lexical +
    0.35 * (i.anchorStrong ? 1 : 0.4) +
    0.3 * coverage +
    0.1 * METHOD_TRUST[i.method];

  score -= 0.15 * i.promoScore;
  score -= Math.min(0.15, 0.05 * i.partialCount);
  if (i.droppedCount > 0) score -= 0.15;

  score = Math.max(0, Math.min(1, score));

  let confidence = bucket(score);
  // An LLM-produced result is never reported as high; it is a fallback, and
  // saying "high" about a generated field is exactly the failure mode to avoid.
  if (i.method === 'llm' && confidence === 'high') confidence = 'medium';
  return { score: Number(score.toFixed(3)), confidence };
}

/**
 * Confidence in an abstention. Strong promotional signal plus no anchor is a
 * confident "not a transaction"; silence on both is merely "I could not tell".
 */
export function scoreAbstention(promoScore: number, sawAnyCandidate: boolean): { score: number; confidence: Confidence } {
  let score = 0.5 + 0.45 * promoScore;
  if (!sawAnyCandidate) score += 0.15;
  score = Math.max(0, Math.min(1, score));
  return { score: Number(score.toFixed(3)), confidence: bucket(score) };
}
