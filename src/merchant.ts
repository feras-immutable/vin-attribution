/**
 * Merchant descriptor normalization and categorization.
 *
 * Card networks return merchant strings that are unstable across transactions
 * for the same vendor: store numbers change, payment processors prepend their
 * own tags, and the same business shows up with and without a corporate suffix.
 * Any rule keyed on the raw string breaks constantly.
 *
 *   "SHELL 57543431704"        ─┐
 *   "SHELL #221"                ├─→  "shell"
 *   "PY *SHELL OIL CO."        ─┘
 */

/**
 * Reduce a raw merchant descriptor to a stable rule key.
 *
 * Digits are stripped wholesale rather than selectively. Store numbers, phone
 * numbers and location codes are all noise, and no merchant identity depends on
 * a digit — "7-Eleven" survives as "eleven", which is still a stable key.
 */
export function normalizeMerchant(merchant: string | null | undefined): string {
  return (merchant || "")
    .toLowerCase()
    .replace(/^(py|tst|sq|sp|pp)\s*\*\s*/i, "")        // payment-processor prefixes
    .replace(/\.com\b/g, "")                            // "alldata.com" → "alldata"
    .replace(/[^a-z0-9\s]/g, " ")                       // punctuation → space
    .replace(/[0-9]/g, " ")                             // store / phone numbers
    .replace(/\b(inc|llc|co|corp|company|ltd)\b/g, "")  // corporate suffixes
    .replace(/\s+/g, " ")
    .trim();
}

export type CostCategory =
  | "transport"
  | "parts"
  | "body"
  | "recon"
  | "title"
  | "detail"
  | "fuel"
  | "other";

/** Free-text signals available for categorization. All optional. */
export interface CategorizableCharge {
  merchant?: string | null;
  merchantCategory?: string | null;
  category?: string | null;
  memo?: string | null;
}

const RULES: Array<[CostCategory, RegExp]> = [
  ["transport", /transport|trans\b|towing|shipper|move/],
  ["parts", /parts|auto parts|napa|o.?reilly|advance|rockauto|carquest/],
  ["body", /body|paint|collision|dent|bumper/],
  ["recon", /mechanic|repair|service|lube|brake|tire|wheel|alignment|engine|transmission/],
  ["title", /title|tag|registration|dmv|notary/],
  ["detail", /detail|wash|clean|interior/],
  ["fuel", /fuel|gas|shell|exxon|chevron|7-eleven/],
];

/**
 * Keyword categorization over every free-text field on the charge.
 *
 * Order matters: rules are evaluated top to bottom and the first hit wins.
 * "transport" precedes "recon" because a towing charge contains "tow" and often
 * also "service"; the more specific intent should win. Anything unmatched
 * returns "other" rather than guessing — a wrong category silently distorts
 * per-vehicle margin, while "other" is visibly incomplete and gets fixed.
 */
export function categorize(charge: CategorizableCharge): CostCategory {
  const haystack = [charge.merchant, charge.merchantCategory, charge.category, charge.memo]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  for (const [category, pattern] of RULES) {
    if (pattern.test(haystack)) return category;
  }
  return "other";
}
