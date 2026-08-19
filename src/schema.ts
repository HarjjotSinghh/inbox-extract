/**
 * schema.org vocabulary actually understood by Gmail's markup pipeline, plus an
 * explicitly-namespaced fallback for the two categories schema.org does not model.
 *
 * Gmail supports: FlightReservation, EventReservation, LodgingReservation,
 * RentalCarReservation, RestaurantReservation, BusReservation, TrainReservation,
 * Order, ParcelDelivery, Invoice.
 * https://developers.google.com/workspace/gmail/markup/reference/schema-org-proposals
 */

export const SCHEMA = {
  flightReservation: 'FlightReservation',
  eventReservation: 'EventReservation',
  reservation: 'Reservation',
  order: 'Order',
  parcelDelivery: 'ParcelDelivery',
  invoice: 'Invoice',
} as const;

/**
 * No schema.org type models a subscription renewal notice. Rather than bend it
 * into Invoice (which implies an amount already payable) we namespace a local
 * type, so a consumer can never mistake it for standard vocabulary.
 */
export const LOCAL = {
  subscriptionRenewal: 'inbox:SubscriptionRenewal',
} as const;

export const ORDER_STATUS = {
  processing: 'https://schema.org/OrderProcessing',
  inTransit: 'https://schema.org/OrderInTransit',
  delivered: 'https://schema.org/OrderDelivered',
  returned: 'https://schema.org/OrderReturned',
  cancelled: 'https://schema.org/OrderCancelled',
  paymentDue: 'https://schema.org/OrderPaymentDue',
  problem: 'https://schema.org/OrderProblem',
} as const;

export const PAYMENT_STATUS = {
  due: 'https://schema.org/PaymentDue',
  pastDue: 'https://schema.org/PaymentPastDue',
  complete: 'https://schema.org/PaymentComplete',
  declined: 'https://schema.org/PaymentDeclined',
  automaticallyApplied: 'https://schema.org/PaymentAutomaticallyApplied',
} as const;

export const DELIVERY_STATUS = {
  inTransit: 'https://schema.org/OrderInTransit',
  delivered: 'https://schema.org/OrderDelivered',
} as const;
