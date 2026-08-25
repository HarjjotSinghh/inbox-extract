import type { Doc } from './normalize.ts';
import type { Category } from './types.ts';

export interface Signal {
  re: RegExp;
  w: number;
  label: string;
}

export interface CategoryScore {
  category: Category;
  score: number;
  raw: number;
  hits: string[];
}

export interface PromoAssessment {
  score: number;
  promoHits: string[];
  txnHits: string[];
}

export interface Classification {
  ranked: CategoryScore[];
  promo: PromoAssessment;
}

/**
 * Marketing lexicon.
 *
 * These fire on the *offer* frame: a conditional invitation to act, priced in
 * discounts rather than in a settled amount. Deliberately sender-agnostic —
 * both decoys arrive from `offers@`, but real promos also arrive from
 * `no-reply@`, so local-part is a weak prior (below), never the decision.
 */
const PROMO: Signal[] = [
  { re: /\b\d{1,3}\s*%\s*off\b/i, w: 1.6, label: 'percent-off' },
  { re: /\bflat\s+\d{1,3}\s*%/i, w: 1.4, label: 'flat-discount' },
  { re: /\bget\s+\d{1,3}\s*%/i, w: 1.2, label: 'get-percent' },
  { re: /\buse\s+(?:promo\s+)?code\b/i, w: 1.8, label: 'use-code' },
  { re: /\b(?:promo|coupon|discount)\s*code\b/i, w: 1.6, label: 'promo-code' },
  { re: /\bT&Cs?\s*apply\b|\bterms\s+(?:and|&)\s+conditions\s+apply\b/i, w: 1.6, label: 'tnc-apply' },
  { re: /\bpre-?approved\b/i, w: 1.8, label: 'pre-approved' },
  { re: /\b(?:apply|shop|buy|order|book|claim|grab)\s+now\b/i, w: 1.5, label: 'cta-now' },
  { re: /\b(?:book|shop|order|spend)\s+any\b/i, w: 1.4, label: 'cta-any' },
  { re: /\blimited\s+(?:time|period|offer)\b|\bhurry\b|\bends\s+(?:today|soon|tonight)\b/i, w: 1.4, label: 'urgency' },
  { re: /\b\d+\s*[xX]\s+(?:reward|cashback|points)/i, w: 1.6, label: 'multiplier-reward' },
  { re: /\bup\s+to\s+(?:₹|rs\.?|\$|€|£)/i, w: 1.2, label: 'up-to-amount' },
  { re: /\b(?:exclusive|special|mega|festive)\s+(?:offer|deal|sale)\b/i, w: 1.5, label: 'offer-language' },
  { re: /\bvalid\s+(?:at|on|till|until|for)\b/i, w: 0.8, label: 'validity-window' },
  { re: /\b(?:sale|deals?|bonanza|clearance)\b/i, w: 0.7, label: 'sale-word' },
  { re: /\bunsubscribe\b/i, w: 0.6, label: 'unsubscribe' },
  { re: /\bearn\s+(?:up\s+to\s+)?\d/i, w: 0.9, label: 'earn' },
  { re: /\bno\s+cost\s+emi\b|\binstant\s+discount\b/i, w: 1.2, label: 'finance-offer' },
  // "Pay ₹799 before 30 Sep and enjoy double data" — a conditional inducement.
  // A real bill states what is owed; it never promises a reward for paying.
  { re: /\b(?:pay|recharge|spend|shop|book|order)\b[^.\n]{0,60}?\band\s+(?:get|enjoy|earn|receive|win|save)\b/i, w: 1.8, label: 'pay-and-get' },
  { re: /\bis\s+about\s+to\s+get\s+better\b|\bgood\s+news[!,]/i, w: 1.0, label: 'upsell-framing' },
  { re: /\bin\s+your\s+cart\b|\bleft\s+(?:something|items?)\s+in\s+your\s+cart\b/i, w: 1.8, label: 'abandoned-cart' },
  { re: /\bhow\s+was\s+your\s+(?:order|booking|appointment)\b|\brate\s+(?:it|your\s+order)\b/i, w: 1.6, label: 'csat' },
];

/**
 * Evidence that something already happened to *this* recipient. Subtracted from
 * the promo score, so a genuine statement that happens to mention an offer is
 * not mistaken for a blast.
 */
const TRANSACTIONAL: Signal[] = [
  // "Your Swiggy order", "Your HDFC Bank statement" — a brand routinely sits
  // between the pronoun and the noun, and the literal form missed all of them.
  { re: /\byour\s+(?:[\w.&-]+\s+){0,2}(?:order|booking|reservation|appointment|statement|bill|refund|package|parcel|shipment|membership|subscription|ticket)\b/i, w: 1.4, label: 'your-thing' },
  { re: /\b(?:is|has been|was)\s+(?:confirmed|shipped|dispatched|delivered|processed|cancelled|canceled|refunded|booked|ready)\b/i, w: 1.6, label: 'settled-verb' },
  { re: /\b(?:is\s+)?on\s+the\s+way\b|\bout\s+for\s+delivery\b|\barriving\s+(?:today|tomorrow)\b/i, w: 1.5, label: 'in-progress-verb' },
  { re: /\bwe\s+have\s+received\s+your\s+payment\b|\bpayment\s+received\b|\bthank\s+you\s+for\s+your\s+payment\b/i, w: 1.6, label: 'payment-received' },
  { re: /\bwe(?:'| ha)ve\s+(?:processed|received|shipped|refunded|issued)\b/i, w: 1.6, label: 'we-have-done' },
  { re: /\b(?:total\s+)?amount\s+due\b|\bpayment\s+due\s+date\b|\bdue\s+date\b/i, w: 1.5, label: 'due-date' },
  { re: /\b(?:tracking|booking|appointment|reservation|order|confirmation)\s*(?:id|no\.?|number)\b/i, w: 1.8, label: 'identifier-label' },
  { re: /\bPNR\b/i, w: 1.8, label: 'pnr' },
  { re: /\bstatement\s+(?:date|for|is\s+ready)\b/i, w: 1.4, label: 'statement' },
  { re: /\bcard\s+ending\b/i, w: 1.2, label: 'card-ending' },
  { re: /\b(?:will\s+renew|renews)\s+on\b/i, w: 1.4, label: 'renews-on' },
  { re: /\bseats?\s*:\s*[A-Z0-9]/i, w: 1.2, label: 'seats' },
  { re: /\bdelivering\s+to\b|\bdelivery\s+address\b/i, w: 1.2, label: 'delivery-address' },
];

const CATEGORY_SIGNALS: Record<Exclude<Category, 'none'>, Signal[]> = {
  flight: [
    { re: /\bPNR\b/i, w: 2.2, label: 'pnr' },
    { re: /\bflight\s*(?:no\.?|number)?\s*[:#]?\s*[A-Z0-9]{2}[\s-]?\d{1,4}\b/i, w: 2.0, label: 'flight-number' },
    { re: /\([A-Z]{3}\)/, w: 1.0, label: 'iata-code' },
    { re: /\b(?:depart|arriv)(?:s|es|ure|al)?\b/i, w: 0.9, label: 'depart-arrive' },
    { re: /\bboarding\s*(?:pass|gate|time)?\b/i, w: 1.2, label: 'boarding' },
    { re: /\bseat\s+\d{1,3}[A-Z]\b/i, w: 1.2, label: 'aircraft-seat' },
    { re: /\b(?:airlines?|airways|indigo|vistara|spicejet|akasa|emirates|lufthansa)\b/i, w: 0.8, label: 'airline-word' },
  ],
  food: [
    { re: /\border\s+from\s+[A-Z]/i, w: 1.8, label: 'order-from-merchant' },
    { re: /\b(?:is\s+)?on\s+the\s+way\b|\bout\s+for\s+delivery\b|\bbeing\s+prepared\b/i, w: 1.4, label: 'delivery-status' },
    { re: /\bestimated\s+(?:delivery|arrival)\b|\bdelivery\s+time\b|\bETA\b/i, w: 1.3, label: 'eta' },
    { re: /\bitems?\s*:/i, w: 1.0, label: 'items-label' },
    { re: /\bdelivering\s+to\b/i, w: 1.2, label: 'delivering-to' },
    { re: /\b(?:zomato|swiggy|ubereats|uber\s*eats|doordash|dominos|blinkit|instamart|bigbasket|zepto|dunzo|grofers|licious)\b/i, w: 1.6, label: 'food-brand' },
    { re: /\b(?:restaurant|kitchen|grocery|groceries)\b/i, w: 0.8, label: 'food-word' },
  ],
  subscription: [
    { re: /\bsubscription\b/i, w: 1.6, label: 'subscription' },
    { re: /\b(?:will\s+)?renew(?:s|al|ing)?\b/i, w: 1.8, label: 'renew' },
    { re: /\bmembership\b/i, w: 1.3, label: 'membership' },
    { re: /\btrial\s+(?:ends|ending|will\s+end|expires|is\s+ending)\b/i, w: 2.2, label: 'trial-ending' },
    { re: /\bauto-?renew\w*\b/i, w: 1.6, label: 'auto-renew' },
    { re: /\byou(?:'ll| will)\s+be\s+charged\b/i, w: 1.4, label: 'will-be-charged' },
    { re: /\bbilling\s+cycle\b|\bnext\s+billing\b/i, w: 1.2, label: 'billing-cycle' },
    { re: /\b(?:premium|basic|standard|pro|plus|family|individual)\s+plan\b/i, w: 1.2, label: 'plan-tier' },
  ],
  event: [
    { re: /\bbooking\s*id\b/i, w: 1.8, label: 'booking-id' },
    { re: /\bseats?\s*:/i, w: 1.8, label: 'seats-label' },
    { re: /\b(?:cinema|theatre|theater|multiplex|auditorium|stadium|arena|venue)\b/i, w: 1.5, label: 'venue-word' },
    { re: /\bmovie\s*:/i, w: 1.6, label: 'movie-label' },
    { re: /\bscreen\s+\d+\b/i, w: 1.2, label: 'screen' },
    { re: /\b(?:show\s?time|showing|matinee)\b/i, w: 1.1, label: 'showtime' },
    { re: /\b(?:bookmyshow|district|paytm\s*insider|ticketmaster|pvr|inox|cinepolis)\b/i, w: 1.4, label: 'ticketing-brand' },
    { re: /\bticket(?:s)?\b/i, w: 0.7, label: 'ticket-word' },
  ],
  refund: [
    { re: /\brefund(?:ed|s)?\b/i, w: 2.2, label: 'refund' },
    { re: /\bcancell?(?:ed|ation)\b/i, w: 1.6, label: 'cancelled' },
    { re: /\boriginal\s+payment\s+(?:method|mode)\b/i, w: 1.8, label: 'original-payment-method' },
    { re: /\b(?:reflect|credited?)\s+(?:back\s+)?(?:in|to)\b/i, w: 1.4, label: 'credited-back' },
    { re: /\breturn(?:ed|s)?\b/i, w: 0.9, label: 'return' },
    { re: /\bbusiness\s+days\b/i, w: 0.9, label: 'business-days' },
  ],
  medical: [
    { re: /\bappointment\b/i, w: 2.0, label: 'appointment' },
    { re: /\b(?:doctor|dr\.?)\s+[A-Z]/i, w: 1.8, label: 'doctor-name' },
    { re: /\b(?:clinic|hospital|diagnostics?|lab|medical\s+cent(?:re|er)|consultation)\b/i, w: 1.5, label: 'clinic-word' },
    { re: /\b(?:dermatolog|cardiolog|dentist|dental|orthoped|p(?:a)?ediatric|gyn(?:a)?ecolog|neurolog|ophthalmolog|psychiatr|physiotherap|radiolog|oncolog|urolog|endocrinolog|ENT|general\s+physician)\w*/i, w: 1.8, label: 'specialty' },
    { re: /\bpatient\b/i, w: 1.1, label: 'patient' },
    { re: /\barrive\s+\d+\s+minutes?\s+early\b/i, w: 1.3, label: 'arrive-early' },
    { re: /\b(?:practo|apollo|1mg|pharmeasy|fortis|manipal|max\s*healthcare)\b/i, w: 1.3, label: 'health-brand' },
  ],
  'credit-card': [
    { re: /\bcredit\s+card\b/i, w: 1.6, label: 'credit-card' },
    { re: /\bstatement\b/i, w: 1.8, label: 'statement' },
    { re: /\bminimum\s+(?:amount\s+)?due\b/i, w: 2.2, label: 'minimum-due' },
    { re: /\btotal\s+amount\s+due\b/i, w: 1.6, label: 'total-amount-due' },
    { re: /\bcard\s*(?:member|holder)\b/i, w: 1.4, label: 'cardmember' },
    { re: /\bcard\s+ending\b/i, w: 1.4, label: 'card-ending' },
    { re: /\b(?:available\s+)?credit\s+limit\b/i, w: 1.3, label: 'credit-limit' },
    { re: /\bstatement\s+date\b/i, w: 1.5, label: 'statement-date' },
  ],
  bill: [
    { re: /\bbill\b/i, w: 1.5, label: 'bill' },
    { re: /\bdue\s+date\b|\bdue\s+on\b|\bpayable\s+by\b/i, w: 1.8, label: 'due-date' },
    { re: /\boverdue\b|\bpayment\s+pending\b/i, w: 1.8, label: 'overdue' },
    { re: /\blate\s+(?:fee|charge|payment\s+charge)\b/i, w: 1.4, label: 'late-fee' },
    { re: /\b(?:postpaid|prepaid|broadband|electricity|water|gas|utility|landline|fibernet)\b/i, w: 1.4, label: 'utility-word' },
    { re: /\bunits?\s+consumed\b|\bkwh\b/i, w: 1.5, label: 'meter-reading' },
    { re: /\bdisconnection\b/i, w: 1.3, label: 'disconnection' },
    { re: /\bbill\s+amount\b|\bamount\s+payable\b/i, w: 1.5, label: 'bill-amount' },
  ],
  shipment: [
    { re: /\btracking\s*(?:id|no\.?|number|code)\b/i, w: 2.2, label: 'tracking-id' },
    { re: /\b(?:has\s+)?shipped\b|\bdispatched\b|\bshipment\b/i, w: 1.8, label: 'shipped' },
    { re: /\bout\s+for\s+delivery\b/i, w: 1.4, label: 'out-for-delivery' },
    { re: /\bexpected\s+delivery\b|\barriving\b|\bestimated\s+arrival\b/i, w: 1.5, label: 'expected-delivery' },
    { re: /\b(?:package|parcel|consignment)\b/i, w: 1.3, label: 'package-word' },
    { re: /\b(?:delhivery|blue\s*dart|bluedart|dtdc|fedex|ups|dhl|ecom\s*express|xpressbees|shadowfax|india\s*post|aramex)\b/i, w: 1.6, label: 'carrier-brand' },
    { re: /\bvia\s+[A-Z][a-z]+\b/, w: 0.7, label: 'via-carrier' },
  ],
  train: [
    { re: /\bPNR\b/i, w: 1.6, label: 'pnr' },
    { re: /\btrain\s*(?:no\.?|number)?\s*[:#]?\s*\d{4,5}\b/i, w: 2.2, label: 'train-number' },
    { re: /\bIRCTC\b/i, w: 1.8, label: 'irctc' },
    { re: /\b(?:coach|berth)\b/i, w: 1.6, label: 'coach-berth' },
    { re: /\b(?:sleeper|3A|2A|1A|AC\s*chair\s*car|general)\s+class\b/i, w: 1.2, label: 'travel-class' },
    { re: /\bchart\s+(?:has\s+been\s+)?prepared\b/i, w: 1.4, label: 'chart-prepared' },
    { re: /\b(?:railway\s+station|platform\s+no\.?)\b/i, w: 1.1, label: 'station-word' },
  ],
  bus: [
    { re: /\bboarding\s+point\b/i, w: 2.0, label: 'boarding-point' },
    { re: /\bbus\s*(?:ticket|booking|operator)\b/i, w: 1.8, label: 'bus-word' },
    { re: /\b(?:redbus|abhibus|intrcity|zingbus|orange\s*travels|vrl|srs\s*travels)\b/i, w: 1.6, label: 'bus-brand' },
    { re: /\b(?:sleeper|semi-?sleeper|volvo|AC)\s+bus\b/i, w: 1.4, label: 'bus-type' },
    { re: /\bdrop(?:ping)?\s+point\b/i, w: 1.2, label: 'drop-point' },
    { re: /\bseat\s+(?:no\.?)?\s*\d{1,2}\b/i, w: 0.8, label: 'bus-seat' },
    // A generic "Booking ID" + "ticket" alone reads as event on wording (both
    // are common to event/hotel/cab too); an explicit "Operator:" label is a
    // travel-vendor-specific cue that a bus confirmation carries even without
    // "boarding point" phrasing.
    { re: /\boperator\s*:/i, w: 1.4, label: 'operator-label' },
  ],
  hotel: [
    { re: /\bcheck-?in\b/i, w: 2.0, label: 'check-in' },
    { re: /\bcheck-?out\b/i, w: 2.0, label: 'check-out' },
    { re: /\b\d+\s+nights?\b/i, w: 1.4, label: 'nights' },
    { re: /\broom\s+type\b|\bguests?\s+per\s+room\b/i, w: 1.3, label: 'room-word' },
    { re: /\b(?:makemytrip|goibibo|booking\.com|agoda|oyo|treebo|fabhotels|airbnb)\b/i, w: 1.6, label: 'hotel-brand' },
    { re: /\bhotel\b/i, w: 0.9, label: 'hotel-word' },
  ],
  cab: [
    { re: /\bpickup\s+(?:location|point)\b/i, w: 1.8, label: 'pickup-location' },
    { re: /\bdrop(?:-off)?\s+(?:location|point)\b/i, w: 1.6, label: 'drop-location' },
    { re: /\b(?:your\s+)?(?:ride|trip|cab)\s+(?:is\s+)?(?:confirmed|booked)\b/i, w: 1.8, label: 'ride-confirmed' },
    { re: /\bdriver\s+details\b/i, w: 1.3, label: 'driver-details' },
    { re: /\b(?:uber|ola|zoomcar|rapido|meru|blu\s*smart)\b/i, w: 1.6, label: 'cab-brand' },
    { re: /\bfare\s+estimate\b|\btrip\s+fare\b/i, w: 1.2, label: 'fare-estimate' },
  ],
  shopping: [
    // Deliberately no generic "order confirmed/placed" signal: that phrasing
    // is equally common in food-delivery mail and would out-compete `food` on
    // wording alone. Multi-day delivery language and a retail brand are the
    // things a food order never carries.
    { re: /\bexpected\s+delivery\b|\barriving\s+(?:on|by)\s+\w+\s+\d/i, w: 1.5, label: 'multi-day-eta' },
    { re: /\b(?:amazon|flipkart|myntra|ajio|nykaa|meesho|snapdeal|tatacliq)\b/i, w: 1.8, label: 'shopping-brand' },
    { re: /\border\s+(?:id|no\.?|number)\b/i, w: 1.0, label: 'order-id-word' },
    { re: /\bitems?\s+ordered\b/i, w: 1.0, label: 'items-ordered' },
  ],
  loan: [
    { re: /\bEMI\b/i, w: 2.0, label: 'emi' },
    { re: /\b(?:installment|instalment)\b/i, w: 1.6, label: 'installment' },
    { re: /\bloan\s+(?:account|a\/c)\b/i, w: 1.8, label: 'loan-account' },
    { re: /\boutstanding\s+(?:principal|balance|amount)\b/i, w: 1.4, label: 'outstanding' },
    { re: /\b(?:bajaj\s*finserv|muthoot|iifl|home\s*credit|tata\s*capital)\b/i, w: 1.3, label: 'lender-brand' },
  ],
  insurance: [
    { re: /\bpolicy\s*(?:no\.?|number)\b/i, w: 2.0, label: 'policy-number' },
    { re: /\bpremium\b/i, w: 1.6, label: 'premium' },
    { re: /\bsum\s+(?:insured|assured)\b/i, w: 1.6, label: 'sum-insured' },
    { re: /\bpolicy\s+(?:renewal|expiry)\b/i, w: 1.4, label: 'policy-renewal' },
    { re: /\b(?:lic|hdfc\s*ergo|icici\s*lombard|star\s*health|bajaj\s*allianz|policybazaar|tata\s*aig)\b/i, w: 1.3, label: 'insurer-brand' },
  ],
  salary: [
    { re: /\bpayslip\b/i, w: 2.0, label: 'payslip' },
    { re: /\bnet\s+pay\b|\bnet\s+salary\b|\btake-?home\b/i, w: 1.8, label: 'net-pay' },
    { re: /\bgross\s+(?:pay|salary|earnings)\b/i, w: 1.4, label: 'gross-pay' },
    { re: /\bCTC\b/i, w: 1.2, label: 'ctc' },
    { re: /\bdeductions?\b/i, w: 1.0, label: 'deductions' },
    { re: /\b(?:zoho\s*payroll|keka|greythr|adp)\b/i, w: 1.2, label: 'payroll-brand' },
  ],
  restaurant: [
    { re: /\btable\s+(?:for|no\.?|number|reserved)\b/i, w: 2.0, label: 'table' },
    { re: /\breservation\s+(?:confirmed|for)\b/i, w: 1.6, label: 'reservation-confirmed' },
    { re: /\bparty\s+size\b|\bcovers\b|\bpax\b/i, w: 1.4, label: 'party-size' },
    { re: /\b(?:dineout|eazydiner|opentable)\b/i, w: 1.3, label: 'dining-brand' },
    { re: /\brestaurant\b/i, w: 0.7, label: 'restaurant-word' },
  ],
};

/** Weak priors from the sending address. Never sufficient on their own. */
const SENDER_PROMO = /^(?:offers?|promo(?:tions?)?|marketing|newsletter|deals?|news|campaign|mailer|updates?)\b/i;
const SENDER_TXN =
  /^(?:no-?reply|do-?not-?reply|orders?|order-update|tickets?|bookings?|appointments?|returns?|refunds?|billing|bill-?alert|cards?|statements?|shipment[-\w]*|tracking|delivery|support|service|account|alerts?|notifications?)\b/i;

const SENDER_CATEGORY: Array<{ re: RegExp; category: Exclude<Category, 'none'>; w: number }> = [
  { re: /^(?:tickets?|bookings?)\b/i, category: 'event', w: 1.0 },
  { re: /^(?:appointments?)\b/i, category: 'medical', w: 1.2 },
  { re: /^(?:returns?|refunds?)\b/i, category: 'refund', w: 1.2 },
  { re: /^(?:shipment[-\w]*|tracking|delivery)\b/i, category: 'shipment', w: 1.2 },
  { re: /^(?:cards?|statements?)\b/i, category: 'credit-card', w: 1.0 },
  { re: /^(?:bill-?alert|billing|bills?)\b/i, category: 'bill', w: 1.0 },
  { re: /^(?:orders?|order-update)\b/i, category: 'food', w: 0.6 },
  { re: /^(?:loans?|emi)\b/i, category: 'loan', w: 1.0 },
  { re: /^(?:policy|insurance|renewals?)\b/i, category: 'insurance', w: 1.0 },
  { re: /^(?:payroll|payslips?|hr)\b/i, category: 'salary', w: 1.2 },
  { re: /^(?:reservations?)\b/i, category: 'restaurant', w: 0.6 },
];

const SUBJECT_MULTIPLIER = 1.4;
/**
 * Promo wording inside a footer counts for far less than the same wording in
 * the message itself. Most genuine Indian commerce mail ships with "Get 20% off
 * your next order / T&C apply / Unsubscribe" stapled to the bottom, and taking
 * that at face value threw away real orders.
 */
const FOOTER_MULTIPLIER = 0.3;

/** Index in `body` where a boilerplate footer starts, or body.length if none. */
export function footerStart(body: string): number {
  const re = /\n[ \t]*(?:[-–—_*=]{3,}|unsubscribe\b|this\s+is\s+an\s+automated|to\s+stop\s+receiving)/gi;
  for (const m of body.matchAll(re)) {
    if (m.index != null && m.index > body.length * 0.5) return m.index;
  }

  // Footers are not always on their own line. A trailing paragraph carrying
  // unsubscribe or T&C boilerplate is a footer wherever it sits.
  const lastBreak = body.lastIndexOf('\n\n');
  if (lastBreak > body.length * 0.35) {
    const tail = body.slice(lastBreak);
    if (/\bunsubscribe\b|\bT&Cs?\s*apply\b|\bterms\s+(?:and|&)\s+conditions\s+apply\b/i.test(tail)) {
      return lastBreak;
    }
  }
  return body.length;
}
const NORMALISER = 3.5;

function scoreSignals(doc: Doc, signals: Signal[]): { raw: number; hits: string[] } {
  let raw = 0;
  const hits: string[] = [];
  for (const s of signals) {
    const inSubject = s.re.test(doc.subject);
    const inBody = s.re.test(doc.body);
    if (!inSubject && !inBody) continue;
    raw += s.w * (inSubject ? SUBJECT_MULTIPLIER : 1);
    hits.push(inSubject ? `${s.label}@subject` : s.label);
  }
  return { raw, hits };
}

/**
 * How strongly this reads as a marketing blast rather than a record.
 *
 * Note both provided decoys come from `offers@`, and the matching genuine
 * emails come from `cards@` / `tickets@` on the *same domain*. Domain is
 * therefore useless and local-part is tempting — so it is capped at a small
 * nudge and the content lexicons carry the decision. Verified by
 * `tests/contract.test.ts`, which strips the sender and still expects 'none'.
 */
export function assessPromo(doc: Doc): PromoAssessment {
  const cut = footerStart(doc.body);
  const main = doc.body.slice(0, cut);
  const footer = doc.body.slice(cut);

  const promo = { raw: 0, hits: [] as string[] };
  for (const sig of PROMO) {
    const inSubject = sig.re.test(doc.subject);
    const inMain = sig.re.test(main);
    const inFooter = footer ? sig.re.test(footer) : false;
    if (!inSubject && !inMain && !inFooter) continue;
    const weight = inSubject
      ? sig.w * SUBJECT_MULTIPLIER
      : inMain
        ? sig.w
        : sig.w * FOOTER_MULTIPLIER;
    promo.raw += weight;
    promo.hits.push(inSubject ? `${sig.label}@subject` : inMain ? sig.label : `${sig.label}@footer`);
  }

  const txn = scoreSignals(doc, TRANSACTIONAL);

  const local = doc.sender.localPart ?? '';
  let raw = promo.raw - txn.raw * 0.75;
  if (SENDER_PROMO.test(local)) {
    raw += 0.6;
    promo.hits.push('sender:promo-mailbox');
  } else if (SENDER_TXN.test(local)) {
    raw -= 0.4;
    txn.hits.push('sender:transactional-mailbox');
  }

  return {
    score: Math.max(0, Math.min(1, raw / 4)),
    promoHits: promo.hits,
    txnHits: txn.hits,
  };
}

export function classify(doc: Doc): Classification {
  const local = doc.sender.localPart ?? '';
  const ranked: CategoryScore[] = [];

  for (const [category, signals] of Object.entries(CATEGORY_SIGNALS) as Array<
    [Exclude<Category, 'none'>, Signal[]]
  >) {
    const { raw, hits } = scoreSignals(doc, signals);
    let total = raw;
    for (const hint of SENDER_CATEGORY) {
      if (hint.category === category && hint.re.test(local)) {
        total += hint.w;
        hits.push(`sender:${category}`);
      }
    }
    if (total <= 0) continue;
    ranked.push({ category, raw: total, score: total / (total + NORMALISER), hits });
  }

  ranked.sort((a, b) => b.raw - a.raw);
  return { ranked, promo: assessPromo(doc) };
}

export const CANDIDATE_FLOOR = 1.4;
