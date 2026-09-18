# vin-attribution

Attribute payment-card charges and vendor checks to individual vehicles by extracting VIN suffixes from free-text memos.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE) ![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6) ![Tests](https://img.shields.io/badge/tests-40%20passing-brightgreen)

> 📄 **[You can't parse your way out of a data-capture problem](./WRITEUP.md)** — why this library exists, what it didn't fix, and how month-end close went from two weeks to under two days.

---

## The problem

A dealership buys a car, then spends money on it — parts, a mechanic, a tow, fuel to move it. Each of those charges belongs to one specific vehicle, and if you cannot attribute them you do not know what any car actually cost you, which means you do not know what you made on it.

The card network knows the merchant and the amount. It does not know the VIN. The only channel carrying the VIN is a free-text memo field, typed by a person standing at a parts counter on their phone.

So the input looks like this:

```
"565722"
"kia sorento 565722"
"wo 123456 vehicle 565722"
"Memo123357"
"brake pads"
```

And the job is to get from that to *this charge belongs to VIN 1HGCM82633A565722*, or to a clear statement of why it could not.

## Install

```bash
npm install vin-attribution
```

## Quick start

```ts
import { attributeCharge } from "vin-attribution";

const inventory = [
  { vin: "1HGCM82633A565722" },
  { vin: "3VWFE21C04M123357" },
];

attributeCharge(
  { id: "txn_1", amount: 142.5, merchant: "ACME AUTO PARTS", memo: "brake pads 565722" },
  inventory,
);
// {
//   status: "matched",
//   chargeId: "txn_1",
//   vin: "1HGCM82633A565722",
//   vin6: "565722",
//   category: "parts",
// }
```

Unattributed charges say why:

```ts
attributeCharge({ id: "txn_2", amount: 60, memo: "shop supplies" }, inventory);
// { status: "unmatched", reason: "no_vin", vin6: null, category: "other", ... }

attributeCharge({ id: "txn_3", amount: 60, memo: "parts for 999999" }, inventory);
// { status: "unmatched", reason: "vin_not_in_inventory", vin6: "999999", ... }
```

## Design notes

Most of the value here is in four decisions, not in the parsing.

### 1. Two extractors, because the two sources fail differently

`extractVin6Loose` is for memos typed on a phone. It will pull a suffix out of `"Memo123357"` where the VIN is jammed onto a label with no separator.

`extractVin6Strict` is for memos typed at a desk — accounting systems, check registers — where the surrounding text is full of numbers that look exactly like VIN suffixes and are not. It rejects date-shaped values (`100324` is October 3rd) and round dollar amounts (`250000` is $2,500.00).

The asymmetry is deliberate. A **missed** match costs one row in a review queue that somebody clears in seconds. A **wrong** match silently posts a cost against the wrong vehicle, corrupts its margin, and nobody ever finds it. So the permissive parser goes where mistakes are cheap and recoverable, and the suspicious parser goes where the input is most likely to contain convincing decoys.

### 2. The digits-only rule

Loose mode's last-resort strategy grabs a trailing six-character run off the final token — for memos like `"Memo123357"` where the VIN is jammed onto a label. It is restricted to **digits**, and that restriction is load-bearing:

```
"hardware"      →  an alphabetic tail would yield "RDWARE"
"transmission"  →  an alphabetic tail would yield "ISSION"
```

`RDWARE` is six characters drawn entirely from the VIN alphabet. Nothing about its shape distinguishes it from a real suffix, and this strategy runs *after* the word-boundary search has already failed — so there is no surrounding context left to appeal to. Restricting the fallback to digits removes that entire class of error by construction rather than trying to blacklist English.

### 3. Failures are typed, and the ratio is the diagnostic

```ts
type UnmatchedReason = "no_vin" | "vin_not_in_inventory" | "ambiguous_vin";
```

This is the part that actually matters in production. Say 30% of charges fail to match. That number tells you nothing on its own. The *composition* of that 30% tells you everything:

- Dominated by **`no_vin`** → a process problem. People are not entering VINs. The fix is card policy, memo enforcement, or one card per buyer. Improving the parser accomplishes nothing.
- Dominated by **`vin_not_in_inventory`** → a coverage problem. The parser works; your inventory sync is incomplete or your matching window is too narrow.
- Any **`ambiguous_vin`** → two vehicles share a suffix. Rare, but never guess — surface both and let a human pick.

Running this logic in a real dealership (early September 2026), 99 of 110 unmatched card charges were `no_vin`, 11 were `vin_not_in_inventory`, and none were ambiguous. Which meant the obvious instinct — write a better regex — would have moved nothing. The instrumentation is what said so.

The absolute match rate is a property of the deployment's data hygiene, not of this library. What the library owes you is an honest account of *why* the misses missed.

### 4. Match rate by count and by value, separately

They diverge, and the divergence is informative. Forty percent of charges matching but five percent of dollars matching means the large charges are the ones failing — a different problem with a different cause than a long tail of small ones. `attributeBatch` reports both.

## Known limitations

Documented rather than hidden, because both are visible in the test suite.

**Any six-letter VIN-legal word is a false positive.** `"oil change"` extracts `CHANGE`. This is not solvable at the string level — the word *is* a valid suffix. It is tolerable only because extraction is followed by a lookup against real inventory: `CHANGE` matches nothing and the charge lands in the review queue. The lookup is the real filter; extraction only has to be cheap and generous.

**The merchant normalizer does not collapse descriptive words.** `"SHELL #221"` and `"PY *SHELL OIL CO."` become `shell` and `shell oil` — two keys for one vendor. Store numbers, processor prefixes and corporate suffixes are unambiguous noise and get stripped; `OIL` might be load-bearing and the normalizer cannot tell. Fixing it needs a vendor alias table, which is worth building when merchant rules start missing and not before.

## API

| Export | Purpose |
|---|---|
| `attributeCharge(charge, inventory, opts?)` | Attribute one charge; returns a discriminated union |
| `attributeBatch(charges, inventory, opts?)` | Attribute many; returns results plus a diagnostic summary |
| `extractVin6Loose(memo)` | Permissive extraction, for phone-typed memos |
| `extractVin6Strict(memo)` | Suspicious extraction, for desk-typed memos |
| `normalizeMerchant(raw)` | Reduce a card descriptor to a stable rule key |
| `categorize(charge)` | Keyword cost category from any free-text fields |
| `vinEndsWith(vin, vin6)` | Case-insensitive suffix check |

## Development

```bash
npm install
npm test          # 40 tests
npm run typecheck
npm run build
```

## Background

Generalized from the expense-reconciliation layer of a production wholesale automotive operations platform, where the same approach attributes our Ramp card charges to vehicle-level P&L. The platform's QuickBooks check path still runs an older extractor and is being moved onto this library. The logic here is the general part; the platform-specific storage, sync and review-queue plumbing is not included.

## How this was built

Designed by Feras Mansi: the matching rules, the loose/strict asymmetry and the failure taxonomy. Implemented with Claude Code, and validated against production transaction data.

## License

MIT
