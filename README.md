# inbox-extract

Structured extraction from transactional email — the thing Gmail does when it turns a booking confirmation into a card.

The brief named five categories. The second attached fixture (`data/fixtures.bills.json`) asked for three more — credit-card, bill, shipment — so this repo covers those eight, plus `flight` (the worked example) and `none`.

```
extract(email) -> { category, schemaType, data, confidence, missing }
```

Two properties are the point:

- **A marketing blast that looks like a booking comes back `category: "none"`.** Not because it matched a promo keyword list, but because there is no booking in it to extract. Coupon-shaped tokens (`SUMMER50`, `PROMO2026`, `CART-88213`) are not treated as booking ids.
- **No field is ever invented.** Every rules-layer value carries the exact span of the email it was read from, and any field that cannot be traced back is deleted before the result is returned. If a field isn't stated, it lands in `missing`. JSON-LD fields are attributed to the sender's markup, not a prose span.

Design rationale, schema mapping and known gaps: **[DECISIONS.md](DECISIONS.md)**.

---

## Run it

Needs **Node 22.6+** (24 recommended) and nothing else. The extractor has **zero runtime dependencies** — dev dependencies are only TypeScript, Vitest and `@types/node`.

```bash
git clone https://github.com/HarjjotSinghh/inbox-extract.git && cd inbox-extract
node --experimental-strip-types src/cli.ts data/fixtures.bills.json data/fixtures.commerce.json --today 2026-09-15
```

That prints a summary and writes results to `out/`. No `npm install` required — Node runs the TypeScript directly. On Node 22.x you will also see `ExperimentalWarning: Type Stripping`; that is Node reporting its own flag, not a problem with the run. Verified on v22.6.0 and v24.18.0.

`data/fixtures.commerce.json` is the attached `emails.json` (food, subscription, event, refund, medical, plus the flight reference and the movie-ticket promo). `data/fixtures.bills.json` is the second attachment (credit-card, bill, shipment). Output for both is in `out/`. Always pass `--today 2026-09-15` (or `--out` to a scratch dir) so a trial run does not overwrite the committed artifacts with your machine's date.

To also run the tests and the scored evaluation:

```bash
npm install && npm run verify
```

`verify` = extract both fixtures → score against the gold file → rebuild the demo page.

| command | does |
|---|---|
| `npm run extract -- <file.json>` | run the extractor over a fixture file |
| `npm run eval` | score against `data/gold.json`; exits non-zero on a misfiled promo or an ungrounded field |
| `npm test` | 78 tests: contract, abstention, vendor variation, parsers, adversarial regressions, LLM trust boundary |
| `npm run demo` | rebuild `demo/index.html` |
| `npm run typecheck` | `tsc --noEmit` |

### See it

Open **`demo/index.html`** — every fixture email on the left, its card on the right. Click any field to highlight the exact text it was read from.

### Output

- `out/output.bills.json`, `out/output.commerce.json` — full results, including provenance
- `out/output.*.slim.json` — only the five keys the brief specifies
- `out/output.all.json` — everything combined

---

## Results on the supplied fixtures

```
cases                        14        promoRejection      100.0% (2/2)
categoryAccuracy             100.0%    falsePositives      0
fieldRecall                  100.0%    hallucinatedFields  0
fieldPrecision               100.0%    perfectCards        100.0%
```

Both promo decoys return `none`. `flight-ref` reproduces the reference output in the brief exactly — that is asserted as a test, not eyeballed.

Fourteen scored cases over 13 distinct emails (the flight reference appears in both fixture files) is a smoke test, not an evaluation; see the last section of [DECISIONS.md](DECISIONS.md).

**Scaling to senders I have never seen:** extraction is generic and verification is strict — a vendor-agnostic label layer plus an LLM fallback both feed the same gate that deletes any field it cannot find verbatim in the email, so an unfamiliar sender costs recall, never precision.

---

## Categories

| category | schema.org type | key fields |
|---|---|---|
| `flight` | `FlightReservation` | reservationId, flightNumber, airports, times, seat |
| `food` | `Order` | merchant, orderId, items[], total, status, eta |
| `subscription` | `inbox:SubscriptionRenewal` | service, plan, amount, renewalDate, status |
| `event` | `EventReservation` | reservationId, eventName, location, startDateTime, seats[], amount |
| `refund` | `Order` (`OrderReturned` / `OrderCancelled`) | merchant, orderId, item, amount, status, eta |
| `medical` | `Reservation` | provider, specialty, location, dateTime, appointmentId |
| `credit-card` | `Invoice` | issuer, cardLast4, statementDate, dueDate, totalDue, minDue, status |
| `bill` | `Invoice` | biller, account, amount, dueDate, status |
| `shipment` | `ParcelDelivery` | carrier, trackingId, item, expectedDelivery, orderId |
| `none` | — | not a transaction |

`bill` covers bills, bills-due and bills-overdue: one extractor, with `status` computed from the due date against `--today`.

---

## The result shape

The five keys in the brief come first; everything after them is additive and safe to ignore.

```jsonc
{
  "category": "bill",
  "schemaType": "Invoice",
  "data": {
    "biller": "Airtel",
    "account": "98•••••21",              // kept masked — un-masking is inventing
    "amount": { "amount": 899, "currency": "INR", "raw": "₹899" },
    "dueDate": "2026-09-17",
    "status": "due-soon"                 // computed from dueDate vs --today
  },
  "confidence": "high",
  "missing": [],

  "partial": [],                         // found, but under-specified
  "score": 0.93,                         // numeric confidence
  "provenance": { "amount": { "quote": "₹899", "start": 71, "end": 75, "rule": "…" } },
  "signals":  [{ "category": "bill", "score": 0.71 }],
  "method": "rules",                     // jsonld | rules | llm | none
  "warnings": [],
  "notes": {}                            // why a field is partial
}
```

For a promo:

```jsonc
{
  "category": "none",
  "schemaType": null,
  "data": null,
  "confidence": "high",
  "missing": [],
  "reason": "Marketing markers present (percent-off@subject, use-code, tnc-apply). No transactional anchor found — the email carries no booking, order, tracking, appointment or statement identifier…"
}
```

---

## How it works

```
email
  └─ normalise ......... HTML → text, entities, sender split, JSON-LD lifted out
  └─ classify .......... weighted wording signals → ranked candidate categories
  └─ extract ........... top 3 candidates each run their own extractor
  └─ anchor gate ....... a category is only assigned if its defining field was found
  └─ ground ............ every field re-checked against the email; failures deleted
  └─ score ............. confidence from anchor strength, field coverage, method
```

Four extraction layers, cheapest first: the sender's own **schema.org JSON-LD** if present → vendor-agnostic **label/value** scanning → category-specific **structure** → an optional **LLM fallback** for unrecognised senders, whose every field must still be located verbatim in the email before it is accepted.

### Optional LLM fallback

Off by default; the whole repo runs offline without it.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm run extract -- data/fixtures.commerce.json --today 2026-09-15 --llm
```

It only runs when the rules came up short, it never overrides a grounded rule result, it is never reported as `high` confidence, and it cannot invent a category — if the rules abstained and the model proposes a transaction without a grounded identifier, the abstention stands.

---

## Layout

```
src/
  pipeline.ts        orchestration and the anchor gate
  classify.ts        category + promo lexicons
  ground.ts          the anti-hallucination check
  confidence.ts      scoring and bucketing
  normalize.ts       Doc: offset-stable view of one email
  jsonld.ts          layer 0 — the sender's own schema.org markup
  status.ts          upcoming / due-soon / overdue
  parse/             money, datetime, ids, label scanning
  extractors/        one file per category
  llm/               optional grounded fallback
eval/run.ts          scored evaluation + independent grounding audit
demo/build.ts        generates demo/index.html
tests/               contract · honesty · vendors · parsers
data/                fixtures + hand-transcribed gold
```

## Using it as a library

```ts
import { extract } from './src/index.ts';

const result = extract(
  { from: 'Airtel <billalert@airtel.com>', subject: 'Bill due soon', body: '…' },
  { today: '2026-09-15', dueSoonDays: 3 },
);
```

`extract()` has no npm dependencies and no Node builtins — import it from `src/pipeline.ts` (not the barrel that also exports `extractAsync`) for a browser or Worker. `extractAsync` is the optional LLM fallback and reads `process.env`.
