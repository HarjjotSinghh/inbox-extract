# DECISIONS

How this works, what I chose, and what I left out.

This started as a 9-category take-home and is now all 18 named in the
category-rework brief. The design did not change to get there — the honesty
gate and the classify→extract→ground pipeline are entirely category-agnostic,
so the 9 new categories are 9 vertical slices against the existing pattern,
not a rewrite. What follows describes both rounds; [Nine more
categories](#nine-more-categories) and [What the 18-category build
found](#what-the-18-category-build-found) are new for the rework.

**The short version — the brief's five questions, one line each:**

| | |
|---|---|
| **Detecting the category** | Classification proposes, extraction disposes. Weighted wording signals shortlist up to six candidate categories; each runs its own extractor, and a category is only assigned if that extractor finds the field that *defines* it. A promo has nothing to extract, so it gets no card. |
| **Mapping to a schema** | Real schema.org vocabulary wherever one fits (`FlightReservation`, `EventReservation`, `Order`, `ParcelDelivery`, `Invoice`), a namespaced `inbox:` type only where schema.org genuinely has none. Full table [below](#category--schemaorg-type). |
| **Missing fields** | Three states, not two: present, `partial` (found but under-specified, like an ETA with no date), or `missing`. Nothing is completed by guessing — `ground()` deletes any field that cannot be traced to a span in the email. |
| **Different vendors** | Four layers, cheapest first: the sender's own JSON-LD → vendor-agnostic label scanning → category-specific structure → an optional LLM fallback, all funnelling through the same verification gate. |
| **What I skipped** | MIME/attachments, non-English, timezones, thread-level entity resolution, and a large enough eval set for the accuracy numbers to mean anything. Detail [below](#what-i-skipped-and-why). |

**Scaling to hundreds of unseen senders:** extraction is generic and verification is strict — a vendor-agnostic label layer plus an LLM fallback both feed the same gate that deletes any field it cannot find verbatim in the email, so an unfamiliar sender costs recall, never precision.

If you read one more section, make it [What an adversarial pass found](#what-an-adversarial-pass-found) — nine real defects and what they say about the design.

---

## The two properties I optimised for

### 1. A marketing blast that looks like a booking must come back `none`

The rule is: **classification proposes, extraction disposes.**

The classifier picks up to six plausible categories from weighted wording signals (sized to the largest vocabulary-sharing family, travel). Each one then *runs its own extractor*, and a category is only assigned if that extractor found the field that defines it — an **anchor**. If nothing anchors, the answer is `none`.

| category | strong anchor (declared on the extractor) |
|---|---|
| flight | PNR **and** a flight number or departure airport — a PNR alone is also what an IRCTC train ticket has |
| event | booking / reservation id |
| food | order id |
| shipment | tracking id |
| refund | order id **and** amount |
| medical | appointment id |
| subscription | renewal date **and** renewing-vs-trial status |
| credit-card | card last-4 **and** a figure that is owed — a statement *date* alone is not one |
| bill | amount **and** due date **and** account number — amount+date alone is what cashback blasts carry |
| train | PNR **and** train number — see [Nine more categories](#nine-more-categories) for why PNR alone is not enough |
| bus / hotel / cab / restaurant | a booking id — the one thing a promo for that vendor never carries |
| shopping | order id — same anchor as `food`; the two are told apart before this point, at classification |
| loan | loan account id **and** EMI amount |
| insurance | policy number |
| salary | payslip id |

Each extractor also declares a weaker `softAnchor` (e.g. event name + time + venue, when no booking id is present) that is enough to build a card but not enough to survive a promo veto. Both are declared as data on the extractor and evaluated **after** grounding, against the fields that actually survived — so a field deleted by the verifier cannot prop up an anchor, and the LLM fallback consults the same definition instead of inventing its own.

This is what makes "Flat 50% off movie tickets this weekend!" fall through. It talks like a booking — cinema, tickets, weekend — but it has no booking id, no seats, no venue, no show time. There is nothing to extract, so there is no card. The same structure handles promos I have never seen, because it tests for the *presence of a transaction* rather than for the *absence of known promo words*.

A promo lexicon exists as well (`% off`, `use code`, `pre-approved`, `T&C apply`, urgency, reward multipliers) but it is a **tiebreak, not the decision**: it can veto a result that only cleared a soft anchor, and it drives the `reason` string. A weak transactional lexicon (`your order`, `we've processed`, `due date`, identifier labels) is subtracted from it so a real statement that happens to mention an offer is not misfiled.

**The trap I deliberately avoided.** Both supplied decoys come from `offers@`, and the matching genuine emails come from `cards@` and `tickets@` **on the same domain**. Keying off the mailbox name would score 100% on this fixture set and then fail on the first promo sent from `no-reply@`. So the sender local-part is a weak prior, never the decision, and `tests/contract.test.ts` re-runs both decoys with the sender deleted, and re-sends the BookMyShow decoy from `tickets@` — still `none`. `tests/vendors.test.ts` adds an unseen promo from `no-reply@ubereats.com`, which is also rejected. Coupon-shaped tokens (`SUMMER50`, `PROMO2026`, `CART-88213`) are not accepted as booking/order/tracking ids.

### 2. Never invent a field

Enforced structurally, not by discipline.

Inside the extractors there is **no way to write a field without a `Found<T>` or an explicit derivation from one** (`Draft.set` and `Draft.derive` are the only two writers of `data` in the codebase) — a value bundled with the exact substring it came from and that substring's offsets. Before anything is returned, `src/ground.ts` re-checks every field:

1. the quote must still exist verbatim at its recorded offsets in the email (offsets are repaired if the text shifted; if the quote is absent entirely, the field is deleted);
2. unless the value is an explicit **derivation** of the quote, the value must be recoverable from that quote.

A field that fails is **deleted from `data` before the result is returned**. The worst case is therefore a field that shows up in `missing` — never a fabricated one. `eval/run.ts` audits this independently, re-reading the raw fixture strings rather than the extractor's own normalised text, and reports **0 hallucinated fields across 232 emitted fields**.

Derivations are the narrow, declared exception: `"20 Sep 2026"` → `"2026-09-20"`, `"₹18,450.00"` → `18450`, a due date → `overdue`. They are flagged `derived: true` in the provenance and still require the quote to be real.

Open `demo/index.html` and click any row: it highlights the exact span that value was read from.

---

## Three states, not two

`missing` is only half of "I don't know". The other half is **found but under-specified**, which is where a careless extractor guesses.

| state | meaning | example |
|---|---|---|
| in `data` | stated in the email | `dueDate: "2026-09-25"` |
| in `partial` | found, but not fully determined | `eta: "20:45"` |
| in `missing` | a declared field the email does not state | `missing: ["eta"]` |

Three worked examples:

- **Zomato**: `Estimated delivery: 8:45 PM`. There is no date anywhere in that email. The obvious fill is "today" — and "today" is exactly the kind of thing that is right until the message is read the next morning. So `eta` is `"20:45"`, listed in `partial`, with a note. The API accepts an optional `email.date`; when a real inbox supplies one the day resolves properly. It is never fabricated when absent.
- **Amazon refund**: `within 3–5 business days` stays verbatim and is marked `partial`. Turning it into a date needs a send date *and* a business-day calendar; neither is in the email.
- **Airtel**: `Account number: 98•••••21` is kept masked. Un-masking would be inventing digits.

Anything in `partial` also lowers `confidence`, so under-specification is visible to a caller that only looks at one field.

---

## Category → schema.org type

Gmail's markup pipeline understands `FlightReservation`, `EventReservation`, `LodgingReservation`, `RentalCarReservation`, `RestaurantReservation`, `BusReservation`, `TrainReservation`, `Order`, `ParcelDelivery`, and `Invoice` ([reference](https://developers.google.com/workspace/gmail/markup/reference/schema-org-proposals)). I used real vocabulary wherever one fits and said so plainly where none does.

| category | schemaType | why |
|---|---|---|
| flight | `FlightReservation` | given |
| event | `EventReservation` | exact fit; Gmail-supported |
| food | `Order` | a delivery order is an `Order`, not a `FoodEstablishmentReservation` (that is a table booking) |
| refund | `Order` | same entity, different `orderStatus` — `OrderReturned` / `OrderCancelled` |
| shipment | `ParcelDelivery` | exact fit |
| bill | `Invoice` | exact fit |
| credit-card | `Invoice` | `minimumPaymentDue`, `totalPaymentDue`, `paymentDueDate` and `accountId` are literally Invoice properties — a card statement is a richer bill |
| medical | `Reservation` | schema.org has **no** medical-appointment type; `Reservation` is the real parent of the whole family, so it is honest rather than invented |
| subscription | `inbox:SubscriptionRenewal` | schema.org has no type that models a subscription *renewal notice*. `MediaSubscription` is the closest real type, but it carries only `authenticator` and `expectsAcceptanceOf` — no amount, renewal date or status — and `Subscription` is a `PriceComponentTypeEnumeration` member, not a type. Forcing it into `Invoice` would imply money already payable, which a renewal notice is not. Namespaced so a consumer can never mistake it for standard vocabulary |
| train | `TrainReservation` | given, Gmail-supported |
| bus | `BusReservation` | given, Gmail-supported |
| hotel | `LodgingReservation` | given, Gmail-supported |
| cab | `RentalCarReservation` | given, Gmail-supported |
| shopping | `Order` | same type as `food` — a retail order is an `Order` too; see [Nine more categories](#nine-more-categories) for how the two stay apart |
| restaurant | `FoodEstablishmentReservation` | the real schema.org type for a table booking. The brief's own table names this category `RestaurantReservation` — that string is not schema.org vocabulary (Gmail's own developer reference names it `RestaurantReservation` too, which is the same non-standard name, not a second real type). `medical` has the identical problem: the brief says `MedicalAppointment`, which also is not schema.org's vocabulary. Both use the real fitting type instead — `Reservation` for medical (schema.org has no medical-appointment type; `Reservation` is the honest parent), `FoodEstablishmentReservation` for restaurant, since that one *does* exist |
| loan | `inbox:LoanInstallment` | no schema.org type models an EMI reminder; `Invoice` would work but `LoanInstallment` names what is actually owed |
| insurance | `inbox:InsurancePolicy` | no schema.org type for a policy premium/renewal notice |
| salary | `inbox:Payslip` | no schema.org type for a payslip. Its fields are personal, not merely transactional, so the `Extractor` interface carries a `sensitive: true` flag a downstream consumer can check before logging or displaying the result — enforced as API metadata, not by hiding anything in this repo's own demo, since every fixture here is synthetic |

Alongside the brief's field names I emit the standard enum URIs too — `paymentStatus: PaymentPastDue`, `orderStatus: OrderInTransit` — so a consumer that already understands those URIs can read them. The card itself is the brief's shape, not schema.org JSON-LD. Where the brief's prose and the fixture's `targetSchemas` disagree (venue/clinic → `location`, booking ID → `reservationId`), I followed the fixture.

Two vocabulary notes. schema.org marks `carrier` as superseded by `provider` on `ParcelDelivery`; the brief names `carrier`, and so does every consumer of this data in practice, so `carrier` is what I emit. And `ParcelDelivery.deliveryStatus` expects a `DeliveryEvent`, not an enumeration member — so that field carries a plain `"in-transit"` / `"delivered"` token rather than a schema.org URI that would not validate.

---

## Nine more categories

Adding train, bus, hotel, cab, shopping, loan, insurance, salary and
restaurant did not touch `ground.ts` or `pipeline.ts` — both are entirely
category-agnostic, operating on `data`/`provenance` keys generically. Each
new category is the same six-touchpoint pattern as the original nine: a
`Category` union entry, an extractor module, a registry entry, a classify
signal set, a schema constant, and an optional JSON-LD map. The actual work
was keeping siblings that share vocabulary from stealing each other's email.

**Travel — PNR is not a flight anchor.** IRCTC's numeric PNR is
indistinguishable in shape from an airline's alphanumeric one, and both
appear beside the word "PNR". `flight`'s anchor was already `reservationId`
**and** a flight number or IATA airport code, precisely so a train ticket
(no flight number, no airport code) cannot satisfy it — this was already true
before `train` existed, verified by a fixture that used to abstain and now
correctly reads as `train` (`tests/redteam.test.ts`). Bus, hotel and cab all
anchor on a booking id instead, which is unambiguous.

**Shopping vs food — same schema.org type, different discriminator.** Both
are `Order`. A vendor allowlist (Amazon = shopping, Swiggy = food) would not
generalise to a merchant neither list has seen, so the classify signals
discriminate on **delivery horizon and retail framing** instead: `shopping`
scores on a multi-day "expected delivery" date and retail-brand words;
`food` scores on same-day/clock-time ETA and delivery-in-progress wording.
Deliberately **not** included: a generic "order confirmed/placed" signal for
`shopping` — that phrasing is just as common in food-delivery mail and
outscored `food` on wording alone for a plain food order with no brand
keyword in the body (`tests/adversarial.test.ts`, caught before merging).

**A generic anchor is not automatically the right category.** `event`'s
anchor is a bare booking/reservation id, which a bus ticket also carries.
Adding `bus` initially lost a bus confirmation to `event` on "Booking ID" +
"ticket" alone, because those are common transactional words and the bus
email in question used "Pickup point" rather than the "boarding point"
phrase `bus` was originally tuned on. The fix was not to weaken `event`, but
to give `bus` an equally-legitimate signal it was missing — an explicit
"Operator:" label, which a real bus confirmation carries even without that
one phrase (`tests/vendors.test.ts`).

**Money siblings stay apart on vocabulary alone.** `loan` (EMI, installment,
outstanding), `insurance` (policy number, premium, sum insured) and `salary`
(net pay, payslip, CTC) share no wording with each other or with `bill` /
`credit-card`, so no special-casing was needed there — the harder part was
robustness within each one (below).

---

## Bills, bills-due and bills-overdue are one extractor

They are the same email; only the relationship between its due date and today differs. One `bill` extractor reads the due date and computes:

```
overdue    dueDate <  today
due-soon   0 ≤ days until due ≤ 3
upcoming   otherwise
```

The **3-day window is a product decision, not something the email states**, so it is a parameter (`dueSoonDays`), recorded here, and easy to change. The reference date is likewise explicit (`--today`) rather than `new Date()`, so committed output is reproducible; without one, `status` is reported in `missing` with a warning rather than silently computed from the machine clock.

Where the email *also* states its status ("is now overdue") and the arithmetic disagrees, the computed `status` is kept and a `warning` is emitted. The stated wording is not stored as a second value.

Credit-card statements share this vocabulary — they are the same shape with a card and a minimum due attached.

---

## Handling vendors I haven't seen

Four layers, cheapest and most reliable first:

**Layer 0 — the sender's own schema.org markup.** Real airlines and merchants ship JSON-LD in the HTML part; this is the mechanism Gmail actually uses. When present it is authoritative and short-circuits everything else, with the text rules still filling gaps it left. Exercised by fixtures as well as tests: `hotel-treebo-jsonld` ships real LodgingReservation markup, and `tests/parse.test.ts` covers the IndiGo FlightReservation path (`method: "jsonld"`).

**Layer 1 — vendor-agnostic label/value scanning.** `Tracking ID:`, `Due date:`, `Total:`, `Booking ID:` are near-universal, because they are written for humans, not for parsers. Labels are tried **most-specific-first**, which is what makes `Statement date … Payment due date` resolve correctly. Two details that bite in practice:

- *Abbreviations.* `Doctor: Dr. Anita Rao (Dermatologist).` — a naive sentence split truncates this to `Dr`. The value scanner only breaks on a full stop when the next non-space character starts something new and the preceding token is not a known abbreviation.
- *Nested labels.* `Available credit limit: ₹1,81,550` ends in `credit limit`. My first version emitted a `creditLimit` field asserting a total limit the email never states — the exact failure the brief warns about, caught by reading the output rather than the code. Labels can now declare phrases they must not be read out of, and there is a test for it.
- *HTML tables with no colons.* This is how HDFC, IRCTC and most Indian utility mail actually ships: `<td>Due Date</td><td>20 Sep 2026</td>`. Stripping tags left `"Due Date 20 Sep 2026"` with nothing marking where the label ends — every field from a table-formatted email was silently lost. `collapse()` now preserves one tab per table-cell boundary instead of folding it into a space, and the label scanner accepts a tab as a separator alongside `:`/`-`/`is`. Fixture coverage: `bus-abhibus-html`, `insurance-hdfcergo-html`, `shopping-flipkart-html`.

**Layer 2 — category-specific structure** for things labels miss: `from Delhi (DEL) to Mumbai (BOM)`, `1x Chicken Biryani (₹320)`, `shipped via Delhivery`, `Dr. Anita Rao (Dermatologist)`.

**Layer 3 — an LLM fallback for anything still unrecognised**, off by default (`--llm`). It only runs when the rules came up short, it is asked for a verbatim quote per field, and **every quote is located in the email before the field is accepted** — ungrounded fields are discarded and counted in `warnings`. An LLM-only result is never reported as `high` confidence, and it cannot invent a *category*: if the rules abstained and the model proposes a transaction without a grounded identifier, the abstention stands.

`tests/vendors.test.ts` runs fifteen senders that appear nowhere in the fixtures across all 18 categories — Swiggy, Flipkart via Blue Dart, Spotify, Apollo, ICICI, Myntra, ConfirmTkt, IntrCity, Goibibo, Rapido, Nykaa, Tata Capital, Star Health, an unbranded employer, an unbranded restaurant — each with different label spellings than its fixture counterpart (`Tracking number` vs `Tracking ID`, `Pay by` vs `Payment due date`, `Instalment` vs `Installment`, `Sum assured` vs `Sum insured`, a card masked as `XXXX1234`), so the tests actually exercise generalisation rather than re-running the same phrasing under a different sender.

---

## Representation choices

- **Money** is `{ amount, currency, raw }`. `raw` keeps the grounding anchor; `amount` is usable. Indian lakh grouping (`₹1,81,550`) and Western grouping (`₹18,450.00`) both parse without a locale guess, since dropping separators resolves both. `10.5% p.a.` is not money and is not read as such.
- **Dates and times** are plain strings, matching the supplied reference exactly: `2026-09-12T08:15`, `2026-09-25`, `20:45`. No timezone is attached because the emails state local wall-clock time and never name a zone — attaching one would be inventing.
- **Composed values quote everything they used.** `departureTime` is built from a date and a clock time stated separately, so its quote spans `12 Sep 2026, departs 08:15` rather than just the time.
- **Overnight flights are refused, not guessed.** If an arrival time precedes its departure time, the leg crosses midnight — but the email does not say which date it lands on, so a day is not added; the time is emitted and flagged `partial`.
- **Ambiguous numeric dates.** `05/09/2026` is 5 Sep or 9 May depending on the sender's locale. Day-first is emitted (dominant outside the US) *and* flagged with a warning, rather than silently picked. Where a component exceeds 12 there is no ambiguity and no flag.
- **Addresses stay verbatim.** `PVR Forum Mall, Bengaluru` is one string. Splitting it into a structured `Place` means deciding which comma-part is the city — an inference the email does not license.
- **Merchant vs platform are separate.** The Zomato card says `merchant: "Meghana Foods"`, `platform: "Zomato"`. Collapsing them puts the wrong name on the card.

---

## What I skipped, and why

- **MIME and real HTML mail.** Tags, entities and JSON-LD are handled; quoted-printable, base64 parts, multipart assembly and tracking-pixel noise are not. That is inbox-plumbing, and it sits upstream of extraction.
- **Attachments.** A PDF statement is common in the wild and would need a different pipeline.
- **Non-English and Hinglish.** The lexicons are English. For an India-first product this is the first gap I would close, and it is mostly lexicon work rather than architecture.
- **Timezones.** No fixture states one. If a sender ever does, the current shape would need an offset.
- **Thread-level entity resolution.** "Order confirmed" → "Shipped" → "Delivered" are three emails about one order and should collapse into one card with a status timeline. That is a store-level concern, not an `extract(email)` concern, but it is the obvious next thing to build.
- **A larger adversarial set.** Promo rejection is now measured on **seven** decoys across nine category families, up from two — better, and still not a strong claim at n=7. The honest next step is unchanged: a few hundred labelled emails per category.

---

## What an adversarial pass found

Everything above describes the design. This describes what happened when I
attacked it with ~70 synthetic emails written specifically to break it, which is
the part I would want to read.

Nine real defects, all now fixed and pinned by tests in `tests/redteam.test.ts`
and `tests/llm.test.ts`:

| defect | what it did |
|---|---|
| **Money digit-smear** | `Bill amount: ₹1,842 214 units consumed` was read as **₹18,42,214**. The digit character class allowed a plain space, so a figure absorbed the next number. It reported `confidence: "high"` with clean provenance |
| **Promo footers deleted real transactions** | A genuine Swiggy order ending in "Get 50% off your next order. T&C apply. Unsubscribe" returned `none`. Most Indian commerce mail carries that footer |
| **An inducement extracted as a bill** | "Pay ₹799 before 30 Sep and enjoy double data" has an amount, a due date and a subscriber number — it satisfied the bill anchor and produced a card for money nobody owes |
| **Credit-limit marketing as a statement** | A card last-4 plus a statement date was enough to anchor, so "your credit limit has been increased" became a `credit-card` |
| **Item lists truncated** | `Items: Chicken Biryani, 2x Coke, Paneer Tikka` yielded one item. Any segment matching the "2x Coke" shape suppressed the fallback for the others |
| **Paid bills scored overdue** | "We have received your payment" with a past due date returned `overdue`, because only the opposite contradiction was checked |
| **Numeric PNRs rejected** | IRCTC uses a 10-digit numeric PNR; the rule required a letter, so every Indian Railways ticket was missed |
| **Crashes on malformed input** | `extract(null)` and a numeric `body` threw instead of abstaining |
| **The LLM path bypassed the grounding gate** | Model-proposed fields were checked by a weaker local matcher that accepted `"123"` out of `"Order #12345"`, and a promoted result kept the abstention's `reason` |

The money bug is the one worth dwelling on, because it defeated the very
mechanism this document spends most of its length describing. `ground()` checked
that `Money.raw` appeared in its quote, and `raw` was smeared identically — so a
fabricated number passed the anti-hallucination check with a perfect audit
trail. The structural guarantee ("nothing is emitted without a span") held
exactly as designed and was **not sufficient**, because it verified the span and
not the value. `ground()` now re-derives the number from `raw` and drops any
amount that does not reconcile.

Two things I would take from that if I were reading this as the reviewer. First,
the abstention knob failed in *both* directions at once — the promo veto that
let an upsell through was the same one deleting real orders — so tuning it
against promos alone would have made the recall problem worse invisibly. Second,
every one of these returned `confidence: "high"`. A calibrated-sounding
confidence score is worth nothing until something adversarial has tried to move
it, which is the argument for building the eval harness before trusting any of
the numbers in it.

## What the 18-category build found

Six real defects surfaced while building and fixture-testing the nine new
categories, all fixed and pinned by tests (`tests/redteam.test.ts`,
`tests/vendors.test.ts`, `tests/parse.test.ts`):

| defect | what it did |
|---|---|
| **Item-list comma smear** | `"1x Cotton Shirt (₹1,299)"` split into two fake items at the thousands-separator comma inside the price. The splitter now tracks paren depth and only splits a comma at depth zero |
| **HTML tables lost every field after the first multiline one** | A table row with no colon (`Total amount\t₹2,199`) was not recognised as a new label boundary inside a multiline value, so one `Items` field swallowed every row after it |
| **Overnight train arrival fabricated a date** | A 22:40 departure / 05:45 arrival with one stated journey date was stamped `<departure-date>T05:45` — a same-day arrival for a train that lands the next morning. Same fix shape as the pre-existing overnight-flight guard, ported to `train.ts` |
| **`trainName` repeated the leading train number** | "Train: 12658 KSR Bengaluru Express" (space, not a dash) fell through to a label match that captured the number along with the name |
| **An EMI amount was silently dropped** | `"EMI of Rs. 12,300"` — a blob-capture pattern (`[^.\n]{1,30}`) stopped at the period inside "Rs." itself, capturing no digits at all |
| **`bus` lost to `event` on generic wording** | "Booking ID" + "ticket" alone, with no "boarding point" phrase, scored higher for `event` (which anchors on a bare booking id) than for `bus`. Fixed by adding a bus-specific "Operator:" label signal, not by weakening `event` |

The pattern across all six: every one was caught by writing a fixture that
looked like real vendor mail and then reading the actual output field by
field against the source text, not by trusting the extractor's own report —
the same discipline the original adversarial pass documents above. None of
them were caught by `tsc` or by the honest-abstention gate, because all six
were "found a plausible-looking wrong answer," not "invented a field out of
nothing" — a reminder that grounding proves a value came from the email, not
that it is the *right* value.

## Numbers

`npm run eval`, against `data/gold.json` (hand-transcribed from the email bodies, not copied from my own output). 98 tests pass; `tsc --noEmit` is clean:

```
cases                        40
categoryAccuracy             100.0%
schemaTypeAccuracy           100.0%
fieldRecall                  100.0%
fieldPrecision               100.0%
perfectCards                 100.0%
promoRejection               100.0% (7/7)
falsePositiveExtractions     0
hallucinatedFields           0
additionalFieldsBeyondGold   23
```

Promo misfiles and ungrounded quotes fail the process. Wrong values vs gold are printed and currently still exit 0.

`additionalFieldsBeyondGold` are grounded fields beyond what the brief listed — `lateFee`, `unitsConsumed`, `availableCredit`, `screen`, `deliveryAddress`, `platform`, `paymentMethodLast4`, `merchant`, `provider`, `orderStatus`, `paymentStatus`, plus the schema.org enums. They are reported separately rather than folded into the score, since scoring myself on fields I chose to add would be meaningless.

At this size the harness buys a **regression gate** and an **independent grounding audit**, not accuracy numbers — those start to mean something at a few hundred labelled emails.
