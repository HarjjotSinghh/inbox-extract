import type { Category } from '../types.ts';
import type { Extractor } from './base.ts';
import { bill } from './bill.ts';
import { creditCard } from './creditCard.ts';
import { event } from './event.ts';
import { flight } from './flight.ts';
import { food } from './food.ts';
import { medical } from './medical.ts';
import { refund } from './refund.ts';
import { shipment } from './shipment.ts';
import { subscription } from './subscription.ts';

export const EXTRACTORS: Record<Exclude<Category, 'none'>, Extractor> = {
  flight,
  food,
  subscription,
  event,
  refund,
  medical,
  'credit-card': creditCard,
  bill,
  shipment,
};

export function extractorFor(category: Category): Extractor | null {
  return category === 'none' ? null : EXTRACTORS[category] ?? null;
}
