# You can't parse your way out of a data-capture problem

*How month-end close went from two weeks to under two days — and why the parser wasn't the fix.*

---

I buy and sell cars wholesale. A few dozen a month, bought at auction, reconditioned, resold. It is a margin business: you make a few thousand dollars on a good car and you lose money on a bad one, and the difference between those two outcomes is often a couple of parts orders and a mechanic's invoice.

Which means the only number that matters is what a specific car actually cost me. And for a long time, I couldn't tell you.

## The problem

A car doesn't cost what you paid for it. It costs what you paid, plus transport, plus the alternator, plus the guy who put the alternator in, plus the detail before it went back to auction, plus the fuel to move it twice. Those charges happen over weeks, across a handful of people, at parts counters and gas stations and independent mechanics who take a card and hand you a receipt.

The card network knows two things about each of those charges: the merchant, and the amount. It does not know which car. Nothing in the payment rail carries a VIN, because no payment rail was designed with vehicles in mind.

So the vehicle identity has to come from a human. That is the entire problem, and everything downstream is a consequence of it.

## How we used to do it

We ran on Amex. Buyers had cards, they bought what the cars needed, and they kept receipts — sometimes. Sometimes a receipt had a VIN written on it. Often it didn't.

Then, at the end of every month, we closed the books. That process looked like this:

1. Print the Amex statement for the month.
2. Go through it line by line with each buyer, asking what each charge was for.
3. When nobody remembered, call the store and ask them to look up the transaction.
4. Write down whatever VIN we landed on.
5. Add it all up.

**It took two weeks. Sometimes longer.**

And after two weeks of that, the output was still wrong in two specific ways. Some VINs were simply incorrect — a buyer's best guess at a charge from three weeks ago, attached to the wrong car, silently distorting that car's margin forever. And somewhere between **10% and 20% of charges never got attributed at all**. They couldn't be. Nobody remembered, the store's records didn't help, and the charge got written off to general expense.

That last part is worth sitting with. A tenth to a fifth of variable spend, on a business where the whole game is per-unit margin, was landing in a bucket labeled *miscellaneous*. Every per-car profit number we produced was wrong by an unknown amount, in a consistent direction.

## The fix I would have built first

My instinct — and I think most engineers' instinct — was to get better at matching.

Build a parser. Pull VINs out of receipt text. Fuzzy-match merchant names against a vendor table. Correlate charge dates against which cars were in recon that week. Maybe OCR the receipt photos. Build something clever enough to reconstruct intent from the evidence.

I'm glad I didn't start there, because it would have worked a little and solved nothing. Every one of those techniques is an attempt to *recover information that was never captured*. The receipt doesn't have a VIN on it because nobody wrote one. No amount of parsing recovers a fact that was never recorded in the first place.

The close wasn't slow because matching was hard. The close was slow because we were asking the question four weeks too late.

## The actual fix

We moved to Ramp, and the change that mattered had almost nothing to do with software I wrote.

- **Only buyers get a card.** Not everyone. The set of people who can create an unattributed charge is as small as it can be.
- **Cards are restricted.** Each one only works at the categories of merchant that buyer actually needs. A card that can't be used at a restaurant can't generate a charge nobody can explain.
- **The buyer gets texted at the moment of the transaction**, asking for a memo.
- **The memo has to contain the last six of the VIN.** If it doesn't, Ramp locks the card until it's filled in.

That last mechanism is Ramp's, not mine — it's a policy setting, and I turned it on. But the design decision was recognizing that it was the whole answer.

Because look at what it changes. At month end, "what was this charge for?" is a *reconstruction* problem — the answer is gone and has to be inferred from receipts, memory, and phone calls. At the register, thirty seconds after the purchase, it isn't a problem at all. The buyer is standing next to the car. He knows exactly what he just bought and why. Asking then costs him six characters.

**The information was never hard to capture. We were just asking at the only moment it was expensive.**

The same principle runs on the accounting side. Vendor payments go out as checks from QuickBooks, and every check description carries the VIN or its last six. That used to mean an end-of-month pass through every check, adding charges per vehicle into a spreadsheet by hand. Now the checks come in on every sync and attribute themselves, because the VIN was written at the moment the check was cut, by the person who knew what it was for.

## What still needs software

Policy gets you most of the way. It doesn't get you all the way, and the gap is where the code lives.

Memos are typed on a phone, by someone in a hurry, standing at a counter. They look like this:

```
"565722"
"kia sorento 565722"
"wo 123456 vehicle 565722"
"Memo123357"
```

Check descriptions, typed at a desk in an accounting system, look different — and they're full of numbers that resemble VIN suffixes and aren't. Invoice numbers. Dates. Round dollar amounts.

So there are two extractors with deliberately different temperaments. The phone one is permissive: it will pull a suffix out of `"Memo123357"` where the VIN got jammed onto a label with no separator. The desk one is suspicious: it rejects six-digit values in the date range, and rejects round multiples of a thousand, because `100324` is the third of October and `250000` is twenty-five hundred dollars.

The asymmetry is deliberate, and it's the one design decision in this system I'd defend hardest:

> **A missed match costs one row in a review queue that somebody clears in seconds. A wrong match silently posts a cost against the wrong car, corrupts its margin, and is never found.**

Those are not the same error and they should not be traded off symmetrically. So the permissive parser goes where mistakes are cheap and visible, and the suspicious parser goes where the input is most likely to contain convincing decoys.

Anything that doesn't resolve lands in a queue, tagged with *why* it didn't:

- **`no_vin`** — nothing VIN-shaped in the memo at all
- **`vin_not_in_inventory`** — a suffix was extracted, but it matches no car we own
- **`ambiguous_vin`** — it matches two cars, so we refuse to guess and surface both

That last one is rare and worth handling anyway. Two vehicles can share a last-six. Picking whichever sorted first would be correct half the time, which is worse than useless because it's invisible.

## What the instrumentation actually said

The typed reasons exist because I wanted the queue to answer a question, not just hold work.

A 25% failure rate tells you nothing on its own. The *composition* of that 25% tells you everything:

- Mostly `no_vin` → a **process** problem. People aren't entering VINs. The fix is policy, not code.
- Mostly `vin_not_in_inventory` → a **coverage** problem. The parser is fine; your inventory sync is incomplete or your matching window is too narrow.

When I looked, the residual was overwhelmingly `no_vin`.

Which means the thing I would have built first — a smarter matcher — would have moved almost nothing. The extraction wasn't failing. It was being handed memos with nothing in them, from the specific corners the card policy doesn't reach: a mechanic paid outside the card system, a charge made before a car was entered, an edge case in the enforcement.

The instrumentation didn't tell me my code was good. It told me my code was not the constraint, which is a more useful thing to learn and the opposite of what I expected.

## Where it ended up

**Month-end close went from two-plus weeks to under two days.** That's an operator's account of my own process rather than an instrumented measurement — nobody was timing the Amex close with a stopwatch — but it's my close, and the difference is not subtle.

The unattributed 10–20% is essentially gone. Not because we got better at finding VINs after the fact, but because a charge can barely be created without one.

The part I didn't anticipate is that eliminating the month-end close eliminated the *concept* of a month-end close. When attribution happens at the register, per-car cost is correct continuously rather than in arrears. I can look at any vehicle right now and see what it has cost so far, how many charges it has taken, and whether it's green or red — while I can still do something about it. Under the old process, I learned a car was underwater roughly three weeks after it stopped mattering.

Closing the month is now mostly checking that the numbers agree, rather than assembling them.

## What I'd do differently

**I'd have moved the question upstream a year earlier.** I spent real time thinking about how to match better before I thought about how to capture better. The capture change took an afternoon of policy configuration and was worth more than any parser I could have written.

**I'd type the failure reasons from day one.** I added them because the queue was annoying to triage, not because I planned to learn anything from them. They turned out to be the most valuable thing in the system, because they're what distinguishes "my code is wrong" from "my process is wrong" — and I would have guessed wrong.

**I'd resist the fallback.** An early version of the strict extractor, having rejected every candidate as a date or a round number, returned one anyway on the theory that a questionable match beats nothing. That made the filter decorative. It now returns nothing and lets the queue do its job. A system that quietly downgrades its own guarantees under pressure is worse than one that admits it doesn't know.

---

The extraction and attribution logic described here is open source and documented, with tests covering both of its known false-positive modes: **[vin-attribution](https://github.com/feras-immutable/vin-attribution)**.

*Feras Mansi runs a wholesale automotive operation in Houston and builds the software it runs on.*
