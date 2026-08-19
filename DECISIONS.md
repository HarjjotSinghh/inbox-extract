# DECISIONS

How this works, what I chose, and what I left out.

---

## Scaling to hundreds of senders I've never seen

**Extraction is generic and verification is strict: a vendor-agnostic label layer plus an LLM fallback both feed the same gate that deletes any field it cannot find verbatim in the email — so an unfamiliar sender costs recall, never precision.**

The rest of this document is how that sentence is implemented.

---

## The two things the brief said actually matter

### 1. A marketing blast that looks like a booking must come back `none`

The rule is: **classification proposes, extraction disposes.**

The classifier picks up to three plausible categories from weighted wording signals. Each one then *runs its own extractor*, and a category is only assigned if that extractor found the field that defines it — an **anchor**. If nothing anchors, the answer is `none`.

| category | anchor |
|---|---|
| flight | PNR or flight number |
| event | booking/reservation id, or event name + start time + venue |
| food | order id, or merchant + total |
| shipment | tracking id, or order id + item |
| refund | amount + outcome (refunded/cancelled) |
| medical | appointment id, or provider + date-time |
| credit-card | card last-4 **and** a statement figure or due date |
| bill | amount **and** a due date (or an account number) |

This is what makes "Flat 50% off movie tickets this weekend!" fall through. It talks like a booking — cinema, tickets, weekend — but it has no booking id, no seats, no venue, no show time. There is nothing to extract, so there is no card. The same structure handles promos I have never seen, because it tests for the *presence of a transaction* rather than for the *absence of known promo words*.

A promo lexicon exists as well (`% off`, `use code`, `pre-approved`, `T&C apply`, urgency, reward multipliers) but it is a **tiebreak, not the decision**: it can veto a result that only cleared a soft anchor, and it drives the `reason` string. A weak transactional lexicon (`your order`, `we've processed`, `due date`, identifier labels) is subtracted from it so a real statement that happens to mention an offer is not misfiled.

**The trap I deliberately avoided.** Both supplied decoys come from `offers@`, and the matching genuine emails come from `cards@` and `tickets@` **on the same domain**. Keying off the mailbox name would score 100% on this fixture set and then fail on the first promo sent from `no-reply@`. So the sender local-part contributes at most ±0.6 to a score built from content, and `tests/contract.test.ts` re-runs both decoys **with the sender deleted entirely** and with the decoy re-sent from `tickets@` — both still return `none`. `tests/vendors.test.ts` adds an unseen promo from `no-reply@ubereats.com`, which is also rejected.

### 2. Never invent a field

Enforced structurally, not by discipline.

Inside the extractors there is **no way to write a field without a `Found<T>`** — a value bundled with the exact substring it came from and that substring's offsets. Before anything is returned, `src/ground.ts` re-checks every field:

1. the quote must still exist verbatim at its recorded offsets in the email (offsets are repaired if the text shifted; if the quote is absent entirely, the field is deleted);
2. unless the value is an explicit **derivation** of the quote, the value must be recoverable from that quote.

A field that fails is **deleted from `data` before the result is returned**. The worst case is therefore a field that shows up in `missing` — never a fabricated one. `eval/run.ts` audits this independently, re-reading the raw fixture strings rather than the extractor's own normalised text, and reports **0 hallucinated fields across 88 emitted fields**.

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
| subscription | `inbox:SubscriptionRenewal` | schema.org has **no** subscription type. Forcing it into `Invoice` would imply money already payable, which a renewal notice is not. Namespaced so a consumer can never mistake it for standard vocabulary |

Alongside the brief's field names I emit the standard enum values too — `paymentStatus: PaymentPastDue`, `orderStatus: OrderInTransit` — so the output drops into a schema.org consumer unchanged.

One naming note: schema.org marks `carrier` as superseded by `provider` on `ParcelDelivery`. The brief names `carrier`, and so does every consumer of this data in practice, so `carrier` is what I emit.

---

## Bills, bills-due and bills-overdue are one extractor

They are the same email; only the relationship between its due date and today differs. One `bill` extractor reads the due date and computes:

```
overdue    dueDate <  today
due-soon   0 ≤ days until due ≤ 3
upcoming   otherwise
```

The **3-day window is a product decision, not something the email states**, so it is a parameter (`dueSoonDays`), recorded here, and easy to change. The reference date is likewise explicit (`--today`) rather than `new Date()`, so committed output is reproducible; without one, `status` is reported in `missing` with a warning rather than silently computed from the machine clock.

Where the email *also* states its status ("is now overdue") and the arithmetic disagrees, both are kept and a `warning` is emitted. Neither side silently wins.

Credit-card statements share this vocabulary — they are the same shape with a card and a minimum due attached.

---

## Handling vendors I haven't seen

Four layers, cheapest and most reliable first:

**Layer 0 — the sender's own schema.org markup.** Real airlines and merchants ship JSON-LD in the HTML part; this is the mechanism Gmail actually uses. When present it is authoritative and short-circuits everything else, with the text rules still filling gaps it left. The fixtures are plain text, so this layer is exercised by a test instead (`tests/parse.test.ts`, IndiGo JSON-LD → `method: "jsonld"`).

**Layer 1 — vendor-agnostic label/value scanning.** `Tracking ID:`, `Due date:`, `Total:`, `Booking ID:` are near-universal, because they are written for humans, not for parsers. Labels are tried **most-specific-first**, which is what makes `Statement date … Payment due date` resolve correctly. Two details that bite in practice:

- *Abbreviations.* `Doctor: Dr. Anita Rao (Dermatologist).` — a naive sentence split truncates this to `Dr`. The value scanner only breaks on a full stop when the next non-space character starts something new and the preceding token is not a known abbreviation.
- *Nested labels.* `Available credit limit: ₹1,81,550` ends in `credit limit`. My first version emitted a `creditLimit` field asserting a total limit the email never states — the exact failure the brief warns about, caught by reading the output rather than the code. Labels can now declare phrases they must not be read out of, and there is a test for it.

**Layer 2 — category-specific structure** for things labels miss: `from Delhi (DEL) to Mumbai (BOM)`, `1x Chicken Biryani (₹320)`, `shipped via Delhivery`, `Dr. Anita Rao (Dermatologist)`.

**Layer 3 — an LLM fallback for anything still unrecognised**, off by default (`--llm`). It only runs when the rules came up short, it is asked for a verbatim quote per field, and **every quote is located in the email before the field is accepted** — ungrounded fields are discarded and counted in `warnings`. An LLM-only result is never reported as `high` confidence, and it cannot invent a *category*: if the rules abstained and the model proposes a transaction without a grounded identifier, the abstention stands.

`tests/vendors.test.ts` runs six senders that appear nowhere in the fixtures — Swiggy, Flipkart via Blue Dart, Spotify, Apollo, ICICI, Myntra — with different label spellings (`Tracking number` vs `Tracking ID`, `Pay by` vs `Payment due date`, `Reference` vs `Appointment ID`, a card masked as `XXXX1234`).

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
- **A larger adversarial set.** Promo rejection is currently measured on **two** emails. 100% on n=2 is not a strong claim, and I would rather say so than round it up. The honest next step is a few hundred labelled emails per category so the numbers mean something.

---

## Numbers

`npm run eval`, against `data/gold.json` (hand-transcribed from the email bodies, not copied from my own output):

```
cases                        14
categoryAccuracy             100.0%
schemaTypeAccuracy           100.0%
fieldRecall                  100.0%
fieldPrecision               100.0%
perfectCards                 100.0%
promoRejection               100.0% (2/2)
falsePositiveExtractions     0
hallucinatedFields           0
additionalFieldsBeyondGold   17
```

The eval exits non-zero if any promo is misfiled or any field fails the grounding audit, so it works as a build gate rather than a printout.

`additionalFieldsBeyondGold` are grounded fields beyond what the brief listed — `lateFee`, `unitsConsumed`, `availableCredit`, `screen`, `deliveryAddress`, `platform`, `paymentMethodLast4`, plus the schema.org enums. They are reported separately rather than folded into the score, since scoring myself on fields I chose to add would be meaningless.

The caveat worth repeating: 14 emails is a smoke test, not an evaluation. What the harness is really buying at this size is the **regression gate** and the **independent grounding audit** — the accuracy percentages only start to mean something at a few hundred labelled emails.
