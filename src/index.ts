export { extract } from './pipeline.ts';
export { extractAsync } from './llm/fallback.ts';
export { Doc, parseSender } from './normalize.ts';
export { classify, assessPromo } from './classify.ts';
export { ground } from './ground.ts';
export { EXTRACTORS } from './extractors/registry.ts';
export { SCHEMA, LOCAL, ORDER_STATUS, PAYMENT_STATUS } from './schema.ts';
export { billStatus, DEFAULT_DUE_SOON_DAYS } from './status.ts';
export type {
  Category, Confidence, Email, ExtractOptions, ExtractionResult,
  LineItem, Money, Provenance, BillStatus,
} from './types.ts';
