import { SCHEMA } from './schema.ts';
import type { Category, Money, Provenance } from './types.ts';

/**
 * Layer 0 — real schema.org markup embedded by the sender.
 *
 * This is the mechanism Gmail itself uses: airlines and merchants ship JSON-LD
 * in the HTML part, and the card is built from that rather than from prose.
 * When it is present it is authoritative, so it short-circuits the text rules.
 */

function get(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
    if (Array.isArray(cur)) cur = cur[0];
  }
  return cur;
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null;

/** schema.org dates carry seconds and an offset; our fields do not. */
const dt = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(s);
  if (!m) return null;
  return m[2] ? `${m[1]}T${m[2]}` : (m[1] ?? null);
};

/**
 * Markup without a stated currency yields no money field. Defaulting to INR
 * would invent the one detail that makes the number mean anything, on the one
 * path where `ground()` cannot check the work.
 */
const money = (amount: unknown, currency: unknown): Money | null => {
  const a = typeof amount === 'number' ? amount : Number(str(amount));
  const code = str(currency);
  if (!Number.isFinite(a) || !code) return null;
  return { amount: a, currency: code, raw: `${code} ${a}` };
};

type FieldMap = Record<string, (node: unknown) => unknown>;

const MAPS: Partial<Record<Category, { type: string; fields: FieldMap }>> = {
  flight: {
    type: SCHEMA.flightReservation,
    fields: {
      reservationId: (n) => str(get(n, 'reservationId')),
      airline: (n) => str(get(n, 'reservationFor.airline.name')),
      flightNumber: (n) => {
        const raw = str(get(n, 'reservationFor.flightNumber'));
        if (!raw) return null;
        const m = /^([A-Z0-9]{2})[\s-]?(\d{1,4})$/i.exec(raw);
        return m ? `${(m[1] ?? '').toUpperCase()} ${m[2]}` : raw;
      },
      departureAirport: (n) => str(get(n, 'reservationFor.departureAirport.iataCode')),
      arrivalAirport: (n) => str(get(n, 'reservationFor.arrivalAirport.iataCode')),
      departureTime: (n) => dt(get(n, 'reservationFor.departureTime')),
      arrivalTime: (n) => dt(get(n, 'reservationFor.arrivalTime')),
      seat: (n) => str(get(n, 'airplaneSeat')) ?? str(get(n, 'reservedTicket.ticketedSeat.seatNumber')),
    },
  },
  event: {
    type: SCHEMA.eventReservation,
    fields: {
      reservationId: (n) => str(get(n, 'reservationId')),
      eventName: (n) => str(get(n, 'reservationFor.name')),
      location: (n) => str(get(n, 'reservationFor.location.name')),
      startDateTime: (n) => dt(get(n, 'reservationFor.startDate')),
      seats: (n) => {
        const s = str(get(n, 'reservedTicket.ticketedSeat.seatNumber'));
        return s ? [s] : null;
      },
      amount: (n) => money(get(n, 'totalPrice'), get(n, 'priceCurrency')),
    },
  },
  shipment: {
    type: SCHEMA.parcelDelivery,
    fields: {
      carrier: (n) => str(get(n, 'carrier.name')) ?? str(get(n, 'provider.name')),
      trackingId: (n) => str(get(n, 'trackingNumber')),
      item: (n) => str(get(n, 'itemShipped.name')),
      expectedDelivery: (n) => dt(get(n, 'expectedArrivalUntil')) ?? dt(get(n, 'expectedArrivalFrom')),
      orderId: (n) => str(get(n, 'partOfOrder.orderNumber')),
      merchant: (n) => str(get(n, 'partOfOrder.merchant.name')),
      deliveryStatus: (n) => str(get(n, 'deliveryStatus')),
    },
  },
  bill: {
    type: SCHEMA.invoice,
    fields: {
      biller: (n) => str(get(n, 'provider.name')),
      account: (n) => str(get(n, 'accountId')),
      amount: (n) => money(get(n, 'totalPaymentDue.price'), get(n, 'totalPaymentDue.priceCurrency')),
      dueDate: (n) => dt(get(n, 'paymentDueDate')),
    },
  },
  food: {
    type: SCHEMA.order,
    fields: {
      merchant: (n) => str(get(n, 'merchant.name')) ?? str(get(n, 'seller.name')),
      orderId: (n) => str(get(n, 'orderNumber')),
      total: (n) => money(get(n, 'totalPrice'), get(n, 'priceCurrency')),
      status: (n) => str(get(n, 'orderStatus')),
      orderStatus: (n) => str(get(n, 'orderStatus')),
    },
  },
  train: {
    type: SCHEMA.trainReservation,
    fields: {
      pnr: (n) => str(get(n, 'reservationId')),
      operator: (n) => str(get(n, 'reservationFor.provider.name')),
      trainNumber: (n) => str(get(n, 'reservationFor.trainNumber')),
      trainName: (n) => str(get(n, 'reservationFor.trainName')),
      departureStation: (n) => str(get(n, 'reservationFor.departureStation.name')),
      arrivalStation: (n) => str(get(n, 'reservationFor.arrivalStation.name')),
      departureTime: (n) => dt(get(n, 'reservationFor.departureTime')),
      arrivalTime: (n) => dt(get(n, 'reservationFor.arrivalTime')),
    },
  },
  bus: {
    type: SCHEMA.busReservation,
    fields: {
      bookingId: (n) => str(get(n, 'reservationId')),
      operator: (n) => str(get(n, 'reservationFor.provider.name')),
      from: (n) => str(get(n, 'reservationFor.departureBusStop.name')),
      to: (n) => str(get(n, 'reservationFor.arrivalBusStop.name')),
      departureTime: (n) => dt(get(n, 'reservationFor.departureTime')),
      arrivalTime: (n) => dt(get(n, 'reservationFor.arrivalTime')),
    },
  },
  hotel: {
    type: SCHEMA.lodgingReservation,
    fields: {
      bookingId: (n) => str(get(n, 'reservationId')),
      hotel: (n) => str(get(n, 'reservationFor.name')),
      checkIn: (n) => dt(get(n, 'checkinTime')),
      checkOut: (n) => dt(get(n, 'checkoutTime')),
      total: (n) => money(get(n, 'totalPrice'), get(n, 'priceCurrency')),
    },
  },
  cab: {
    type: SCHEMA.rentalCarReservation,
    fields: {
      bookingId: (n) => str(get(n, 'reservationId')),
      pickup: (n) => str(get(n, 'pickupLocation.name')),
      drop: (n) => str(get(n, 'dropoffLocation.name')),
      pickupTime: (n) => dt(get(n, 'pickupTime')),
    },
  },
  restaurant: {
    type: SCHEMA.foodEstablishmentReservation,
    fields: {
      bookingId: (n) => str(get(n, 'reservationId')),
      restaurant: (n) => str(get(n, 'reservationFor.name')),
      dateTime: (n) => dt(get(n, 'startTime')),
      partySize: (n) => {
        const v = get(n, 'partySize');
        const num = typeof v === 'number' ? v : Number(str(v));
        return Number.isFinite(num) ? num : null;
      },
    },
  },
};

const TYPE_TO_CATEGORY: Record<string, Category> = {
  FlightReservation: 'flight',
  TrainReservation: 'train',
  BusReservation: 'bus',
  LodgingReservation: 'hotel',
  RentalCarReservation: 'cab',
  FoodEstablishmentReservation: 'restaurant',
  EventReservation: 'event',
  ParcelDelivery: 'shipment',
  Invoice: 'bill',
  Order: 'food',
};

export interface JsonLdHit {
  category: Category;
  schemaType: string;
  data: Record<string, unknown>;
  provenance: Record<string, Provenance>;
}

function typeOf(node: unknown): string | null {
  const raw = get(node, '@type');
  const s = str(raw);
  return s ? s.replace(/^https?:\/\/schema\.org\//, '') : null;
}

export function readJsonLd(nodes: unknown[]): JsonLdHit | null {
  for (const node of nodes) {
    const type = typeOf(node);
    if (!type) continue;
    let category = TYPE_TO_CATEGORY[type];
    if (!category) continue;

    // An Order that has been returned or cancelled is a refund notice.
    if (type === 'Order') {
      const st = str(get(node, 'orderStatus')) ?? '';
      if (/OrderReturned|OrderCancelled/i.test(st)) category = 'refund';
    }

    const map = MAPS[category] ?? MAPS.food;
    if (!map) continue;

    const data: Record<string, unknown> = {};
    const provenance: Record<string, Provenance> = {};
    for (const [field, read] of Object.entries(map.fields)) {
      const value = read(node);
      if (value == null || value === '') continue;
      data[field] = value;
      provenance[field] = {
        source: 'jsonld',
        quote: `${type}.${field}`,
        start: 0,
        end: 0,
        rule: 'jsonld.map',
      };
    }
    if (Object.keys(data).length === 0) continue;
    return { category, schemaType: map.type, data, provenance };
  }
  return null;
}
