import { extractVin6Loose, extractVin6Strict, vinEndsWith } from "./vin.js";
import { categorize, type CostCategory, type CategorizableCharge } from "./merchant.js";

/**
 * A charge to be attributed. Deliberately minimal — this library does not care
 * where the charge came from, only that it has a memo and an amount.
 */
export interface Charge extends CategorizableCharge {
  id: string;
  amount: number;
  memo?: string | null;
  /** Additional free-text fields to search if the memo yields nothing.
   *  Check line-item descriptions, invoice notes, etc. */
  additionalText?: Array<string | null | undefined>;
}

/** A vehicle the charge might belong to. */
export interface Vehicle {
  vin: string;
}

/**
 * Why a charge could not be attributed.
 *
 * These are typed rather than a boolean because they route differently and,
 * more importantly, because their *ratio* is the diagnostic that tells you
 * where to spend effort. A queue dominated by `no_vin` is a process problem —
 * people are not entering VINs. A queue dominated by `vin_not_in_inventory` is
 * a coverage problem — the matcher is fine, the inventory is incomplete.
 *
 * The same 30% failure rate means two completely different things, and only
 * this field distinguishes them.
 */
export type UnmatchedReason =
  /** No VIN-shaped token found in any searched field. */
  | "no_vin"
  /** A VIN suffix was extracted but matches no vehicle in the inventory. */
  | "vin_not_in_inventory"
  /** The suffix matches more than one vehicle — cannot be assigned safely. */
  | "ambiguous_vin";

export type AttributionResult =
  | {
      status: "matched";
      chargeId: string;
      vin: string;
      vin6: string;
      category: CostCategory;
    }
  | {
      status: "unmatched";
      chargeId: string;
      reason: UnmatchedReason;
      /** Present for `vin_not_in_inventory` and `ambiguous_vin`. */
      vin6: string | null;
      /** Populated for `ambiguous_vin` so a human can pick. */
      candidates?: string[];
      category: CostCategory;
    };

export interface AttributeOptions {
  /**
   * Which extractor to use.
   *
   * `"loose"` (default) for memos typed on a phone at a parts counter. Accepts
   * VINs jammed onto labels without a separator.
   *
   * `"strict"` for memos typed at a desk — accounting systems, check registers —
   * where the text is full of dates and dollar amounts that look like VIN
   * suffixes.
   *
   * The asymmetry is deliberate and worth stating plainly: a missed match costs
   * one row in a review queue that somebody clears in seconds. A *wrong* match
   * silently posts a cost to the wrong vehicle and corrupts its margin, and
   * nobody finds it. So the phone-typed source gets the permissive parser and
   * the desk-typed source gets the suspicious one, because the desk source is
   * the one carrying dates and round numbers.
   */
  mode?: "loose" | "strict";
}

/**
 * Attribute a single charge to a vehicle.
 *
 * Searches the memo first, then any `additionalText` fields in order, and stops
 * at the first field that yields a VIN suffix.
 */
export function attributeCharge(
  charge: Charge,
  inventory: readonly Vehicle[],
  options: AttributeOptions = {},
): AttributionResult {
  const extract = options.mode === "strict" ? extractVin6Strict : extractVin6Loose;
  const category = categorize(charge);

  const fields = [charge.memo, ...(charge.additionalText ?? [])];
  let vin6: string | null = null;
  for (const field of fields) {
    vin6 = extract(field);
    if (vin6) break;
  }

  if (!vin6) {
    return { status: "unmatched", chargeId: charge.id, reason: "no_vin", vin6: null, category };
  }

  const matches = inventory.filter((v) => vinEndsWith(v.vin, vin6!));

  if (matches.length === 1) {
    return { status: "matched", chargeId: charge.id, vin: matches[0].vin, vin6, category };
  }

  if (matches.length === 0) {
    return { status: "unmatched", chargeId: charge.id, reason: "vin_not_in_inventory", vin6, category };
  }

  return {
    status: "unmatched",
    chargeId: charge.id,
    reason: "ambiguous_vin",
    vin6,
    candidates: matches.map((v) => v.vin),
    category,
  };
}

export interface AttributionSummary {
  total: number;
  matched: number;
  unmatched: number;
  matchRateByCount: number;
  matchRateByValue: number;
  matchedValue: number;
  unmatchedValue: number;
  byReason: Record<UnmatchedReason, { count: number; value: number }>;
}

/**
 * Attribute a batch and report both the results and the diagnostic breakdown.
 *
 * The summary reports match rate by count *and* by value because they diverge,
 * and the divergence is informative: a high count rate with a low value rate
 * means the large charges are the ones failing, which is the expensive kind of
 * failure and usually has a different cause than the long tail.
 */
export function attributeBatch(
  charges: readonly Charge[],
  inventory: readonly Vehicle[],
  options: AttributeOptions = {},
): { results: AttributionResult[]; summary: AttributionSummary } {
  const results = charges.map((c) => attributeCharge(c, inventory, options));
  const amountOf = new Map(charges.map((c) => [c.id, c.amount]));

  const byReason: AttributionSummary["byReason"] = {
    no_vin: { count: 0, value: 0 },
    vin_not_in_inventory: { count: 0, value: 0 },
    ambiguous_vin: { count: 0, value: 0 },
  };

  let matched = 0;
  let matchedValue = 0;
  let unmatchedValue = 0;

  for (const r of results) {
    const amount = amountOf.get(r.chargeId) ?? 0;
    if (r.status === "matched") {
      matched++;
      matchedValue += amount;
    } else {
      unmatchedValue += amount;
      byReason[r.reason].count++;
      byReason[r.reason].value += amount;
    }
  }

  const total = results.length;
  const totalValue = matchedValue + unmatchedValue;

  return {
    results,
    summary: {
      total,
      matched,
      unmatched: total - matched,
      matchRateByCount: total ? matched / total : 0,
      matchRateByValue: totalValue ? matchedValue / totalValue : 0,
      matchedValue,
      unmatchedValue,
      byReason,
    },
  };
}
