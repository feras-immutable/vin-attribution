/**
 * VIN-suffix extraction from free-text payment memos.
 *
 * A VIN is 17 characters. Nobody types 17 characters into a memo field at a
 * parts counter. What people actually type is the last 6 — enough to identify
 * a vehicle uniquely within a dealer's inventory, short enough to write on a
 * receipt.
 *
 * VIN alphabet is 0-9 and A-Z minus I, O and Q (excluded by the ISO standard
 * precisely because they are confusable with 1 and 0).
 */

const VIN_CHAR = "A-HJ-NPR-Z0-9";
const EXACT = new RegExp(`^[${VIN_CHAR}]{6}$`, "i");
const BOUNDED = new RegExp(`\\b[${VIN_CHAR}]{6}\\b`, "gi");

/**
 * Loose extraction — for memos typed on a phone.
 *
 * Tries three strategies in order:
 *
 *   1. The whole memo is a VIN suffix.            "565722"
 *   2. A VIN-legal token on word boundaries.      "kia sorento 565722"
 *   3. A trailing 6-digit run off the last token. "Memo123357"
 *
 * Strategy 2 prefers the LAST match, because in practice the VIN trails the
 * description rather than leading it.
 *
 * Strategy 3 is deliberately restricted to digits. A six-character alphabetic
 * tail would happily slice the end off an English word — "transmission" would
 * yield "ission", which is VIN-legal and completely wrong. Digits-only makes
 * that class of error impossible.
 */
export function extractVin6Loose(memo: string | null | undefined): string | null {
  if (!memo) return null;
  const cleaned = String(memo).trim();
  if (!cleaned) return null;

  // 1. Whole memo is exactly a VIN suffix.
  if (EXACT.test(cleaned)) return cleaned.toUpperCase();

  // 2. VIN-legal token on word boundaries; prefer the last.
  const bounded = cleaned.match(BOUNDED);
  if (bounded?.length) return bounded[bounded.length - 1].toUpperCase();

  // 3. VIN jammed onto a label with no separator. Digits only — see above.
  const tokens = cleaned.match(/[A-Z0-9]+/gi);
  if (tokens?.length) {
    const last = tokens[tokens.length - 1];
    if (last.length > 6) {
      const tail = last.slice(-6);
      if (/^\d{6}$/.test(tail)) return tail;
    }
  }

  return null;
}

/**
 * Strict extraction — for memos typed at a desk (accounting systems, check
 * registers).
 *
 * Same boundary search as strategy 2 above, but with false-positive rejection,
 * and no jammed-token fallback. Desk-typed memos are full of numbers that look
 * like VIN suffixes and are not:
 *
 *   - Dates. "Invoice 100324" is October 3rd, not a vehicle. Six-digit values
 *     in the MMDDYY / YYMMDD range are rejected outright.
 *   - Round amounts. "Deposit 250000" is $2,500.00. Any multiple of 1000 is
 *     rejected.
 *
 * Both filters only apply to all-digit candidates — a suffix containing a
 * letter cannot be a date or a dollar amount, so it is always accepted.
 *
 * If every candidate is rejected, this returns null rather than falling back to
 * one of them. That is a deliberate choice: having gone to the trouble of
 * identifying a token as a date, handing it back anyway would make the filter
 * decorative. A charge with no usable suffix belongs in the review queue, where
 * a human resolves it in seconds — not posted against whichever vehicle happens
 * to end in today's date.
 */
export function extractVin6Strict(memo: string | null | undefined): string | null {
  if (!memo) return null;

  const matches = String(memo).match(BOUNDED);
  if (!matches) return null;

  for (let i = matches.length - 1; i >= 0; i--) {
    const candidate = matches[i].toUpperCase();

    if (/^\d{6}$/.test(candidate)) {
      const n = parseInt(candidate, 10);
      if (n >= 10100 && n <= 123199) continue; // date-like
      if (n % 1000 === 0) continue;            // round amount
    }
    return candidate;
  }

  return null;
}

/** True if `vin` (full 17-char) ends with `vin6`. Case-insensitive. */
export function vinEndsWith(vin: string, vin6: string): boolean {
  return vin.toUpperCase().endsWith(vin6.toUpperCase());
}
