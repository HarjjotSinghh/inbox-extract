import type { Category } from '../types.ts';
import type { Extractor } from './base.ts';
import { bill } from './bill.ts';
import { bus } from './bus.ts';
import { cab } from './cab.ts';
import { creditCard } from './creditCard.ts';
import { event } from './event.ts';
import { flight } from './flight.ts';
import { food } from './food.ts';
import { hotel } from './hotel.ts';
import { insurance } from './insurance.ts';
import { loan } from './loan.ts';
import { medical } from './medical.ts';
import { refund } from './refund.ts';
import { restaurant } from './restaurant.ts';
import { salary } from './salary.ts';
import { shipment } from './shipment.ts';
import { shopping } from './shopping.ts';
import { subscription } from './subscription.ts';
import { train } from './train.ts';

export const EXTRACTORS: Record<Exclude<Category, 'none'>, Extractor> = {
  flight,
  train,
  bus,
  hotel,
  cab,
  food,
  shopping,
  subscription,
  event,
  refund,
  medical,
  'credit-card': creditCard,
  bill,
  shipment,
  loan,
  insurance,
  salary,
  restaurant,
};

export function extractorFor(category: Category): Extractor | null {
  return category === 'none' ? null : EXTRACTORS[category] ?? null;
}
