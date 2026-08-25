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
  trainReservation: 'TrainReservation',
  busReservation: 'BusReservation',
  lodgingReservation: 'LodgingReservation',
  rentalCarReservation: 'RentalCarReservation',
  foodEstablishmentReservation: 'FoodEstablishmentReservation',
  eventReservation: 'EventReservation',
  reservation: 'Reservation',
  order: 'Order',
  parcelDelivery: 'ParcelDelivery',
  invoice: 'Invoice',
} as const;

/**
 * No schema.org type models these, or the brief's own name for it
 * (`MedicalAppointment`) is not real schema.org vocabulary. Rather than bend a
 * real type to fit (Invoice implies an amount already payable; medical instead
 * reuses Reservation, which is real) we namespace a local type, so a consumer
 * can never mistake it for standard vocabulary. See DECISIONS.md for the full
 * per-category rationale.
 */
export const LOCAL = {
  subscriptionRenewal: 'inbox:SubscriptionRenewal',
  loanInstallment: 'inbox:LoanInstallment',
  insurancePolicy: 'inbox:InsurancePolicy',
  payslip: 'inbox:Payslip',
} as const;

export const ORDER_STATUS = {
  processing: 'https://schema.org/OrderProcessing',
  inTransit: 'https://schema.org/OrderInTransit',
  delivered: 'https://schema.org/OrderDelivered',
  returned: 'https://schema.org/OrderReturned',
  cancelled: 'https://schema.org/OrderCancelled',
} as const;

export const PAYMENT_STATUS = {
  due: 'https://schema.org/PaymentDue',
  pastDue: 'https://schema.org/PaymentPastDue',
  complete: 'https://schema.org/PaymentComplete',
} as const;

