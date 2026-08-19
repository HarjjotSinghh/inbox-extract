import { scoreResult } from '../confidence.ts';
import { extractorFor } from '../extractors/registry.ts';
import { Doc } from '../normalize.ts';
import { extract } from '../pipeline.ts';
import type { Email, ExtractOptions, ExtractionResult, Provenance } from '../types.ts';
import { buildUserMessage, SYSTEM, TOOL } from './prompt.ts';

const DEFAULT_MODEL = 'claude-sonnet-5';
const API_URL = 'https://api.anthropic.com/v1/messages';

interface LlmField { name: string; value: string; quote: string }
interface LlmReply { category: string; fields: LlmField[]; reason?: string }

/**
 * Unknown-sender fallback.
 *
 * The rules are the fast, free, auditable path and stay authoritative. The model
 * only ever runs when the rules came up short, and every field it proposes is
 * checked against the email before it is accepted — so an unfamiliar sender
 * costs recall, never precision. Off unless `llm: true`.
 */
export async function extractAsync(email: Email, options: ExtractOptions = {}): Promise<ExtractionResult> {
  const base = extract(email, options);
  if (!options.llm) return base;

  const apiKey = options.llmApiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ...base, warnings: [...(base.warnings ?? []), 'LLM fallback requested but ANTHROPIC_API_KEY is not set; rules-only result returned.'] };
  }
  if (!needsFallback(base)) return base;

  const doc = new Doc(email);
  let reply: LlmReply;
  try {
    reply = await callClaude(doc, base, apiKey, options.llmModel ?? DEFAULT_MODEL);
  } catch (err) {
    return { ...base, warnings: [...(base.warnings ?? []), `LLM fallback failed: ${String(err)}; rules-only result returned.`] };
  }

  return merge(doc, base, reply);
}

function needsFallback(r: ExtractionResult): boolean {
  return r.category === 'none' || r.confidence !== 'high' || r.missing.length > 0;
}

async function callClaude(doc: Doc, base: ExtractionResult, apiKey: string, model: string): Promise<LlmReply> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name },
      messages: [{
        role: 'user',
        content: buildUserMessage(doc, base.missing, base.category === 'none' ? null : base.category),
      }],
    }),
  });

  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const body = (await res.json()) as { content?: Array<{ type: string; name?: string; input?: unknown }> };
  const call = body.content?.find((c) => c.type === 'tool_use' && c.name === TOOL.name);
  if (!call?.input) throw new Error('model returned no tool call');
  return call.input as LlmReply;
}

/** Whitespace-tolerant verbatim search; anything not found is discarded. */
function locate(haystack: string, needle: string): { start: number; end: number; quote: string } | null {
  const direct = haystack.indexOf(needle);
  if (direct >= 0) return { start: direct, end: direct + needle.length, quote: needle };

  const flexible = new RegExp(needle.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'i');
  const m = flexible.exec(haystack);
  return m?.index == null ? null : { start: m.index, end: m.index + m[0].length, quote: m[0] };
}

function merge(doc: Doc, base: ExtractionResult, reply: LlmReply): ExtractionResult {
  if (reply.category === 'none') {
    return base.category === 'none'
      ? { ...base, reason: base.reason ?? reply.reason }
      : base; // The rules found a real anchor; a model opinion does not remove it.
  }

  const category = base.category === 'none' ? (reply.category as ExtractionResult['category']) : base.category;
  const extractor = extractorFor(category);
  if (!extractor) return base;

  const data: Record<string, unknown> = { ...(base.data ?? {}) };
  const provenance: Record<string, Provenance> = { ...(base.provenance ?? {}) };
  const rejected: string[] = [];
  let accepted = 0;

  for (const field of reply.fields ?? []) {
    if (!field?.name || !field.value) continue;
    if (Object.hasOwn(data, field.name)) continue; // rules win

    const at = locate(doc.text, field.quote);
    if (!at || !locate(at.quote, field.value)) {
      rejected.push(field.name);
      continue;
    }
    data[field.name] = field.value;
    provenance[field.name] = { source: 'llm', quote: at.quote, start: at.start, end: at.end, rule: 'llm.verified' };
    accepted += 1;
  }

  // Adopting a category on model say-so alone is exactly the promo failure mode,
  // so an LLM-only category needs a grounded identifier to stand.
  const anchorStrong = Boolean(base.data) || /Id$|^reservationId$|^trackingId$|^orderId$/.test(Object.keys(data).find((k) => /Id$/.test(k)) ?? '');
  if (base.category === 'none' && !anchorStrong) {
    return { ...base, warnings: [...(base.warnings ?? []), `LLM proposed '${reply.category}' but produced no grounded identifier; abstention kept.`] };
  }

  const missing = extractor.required.filter((f) => !Object.hasOwn(data, f));
  const { score, confidence } = scoreResult({
    lexical: base.signals?.[0]?.score ?? 0.5,
    anchorStrong,
    requiredFound: extractor.required.length - missing.length,
    requiredTotal: extractor.required.length,
    promoScore: 0,
    partialCount: base.partial?.length ?? 0,
    droppedCount: rejected.length,
    method: 'llm',
  });

  return {
    ...base,
    category,
    schemaType: extractor.schemaType,
    data,
    provenance,
    missing,
    confidence,
    score,
    method: 'llm',
    warnings: [
      ...(base.warnings ?? []),
      `LLM fallback accepted ${accepted} field(s).`,
      ...(rejected.length ? [`Rejected ${rejected.length} ungrounded LLM field(s): ${rejected.join(', ')}.`] : []),
    ],
  };
}
