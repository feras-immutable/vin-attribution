import { describe, it, expect } from "vitest";
import { attributeCharge, attributeBatch, type Charge, type Vehicle } from "../src/attribute.js";

// Synthetic inventory. Note the last two share the suffix "441120" — that
// collision is deliberate and is exercised below.
const INVENTORY: Vehicle[] = [
  { vin: "1HGCM82633A565722" },
  { vin: "3VWFE21C04M123357" },
  { vin: "1FTFW1ET5DFA10039" },
  { vin: "5NPE24AF1FH441120" },
  { vin: "JN8AS5MT9DW441120" },
];

const charge = (over: Partial<Charge> = {}): Charge => ({
  id: "c1",
  amount: 100,
  merchant: "ACME AUTO PARTS",
  memo: null,
  ...over,
});

describe("attributeCharge", () => {
  it("matches a charge to exactly one vehicle", () => {
    const r = attributeCharge(charge({ memo: "brake pads 565722" }), INVENTORY);
    expect(r.status).toBe("matched");
    if (r.status === "matched") {
      expect(r.vin).toBe("1HGCM82633A565722");
      expect(r.vin6).toBe("565722");
      expect(r.category).toBe("parts");
    }
  });

  it("reports no_vin when the memo carries no suffix", () => {
    const r = attributeCharge(charge({ memo: "shop supplies" }), INVENTORY);
    expect(r.status).toBe("unmatched");
    if (r.status === "unmatched") {
      expect(r.reason).toBe("no_vin");
      expect(r.vin6).toBeNull();
    }
  });

  it("distinguishes 'parsed but unknown' from 'nothing to parse'", () => {
    // This is the distinction that tells you whether you have a process
    // problem or a coverage problem. Both are failures; they are not the
    // same failure and they do not have the same fix.
    const r = attributeCharge(charge({ memo: "parts for 999999" }), INVENTORY);
    expect(r.status).toBe("unmatched");
    if (r.status === "unmatched") {
      expect(r.reason).toBe("vin_not_in_inventory");
      expect(r.vin6).toBe("999999"); // extraction worked; lookup did not
    }
  });

  it("refuses to guess when a suffix matches two vehicles", () => {
    const r = attributeCharge(charge({ memo: "tires 441120" }), INVENTORY);
    expect(r.status).toBe("unmatched");
    if (r.status === "unmatched") {
      expect(r.reason).toBe("ambiguous_vin");
      expect(r.candidates).toHaveLength(2);
      // Candidates are surfaced so a human can pick, rather than the system
      // silently posting the cost to whichever one sorted first.
      expect(r.candidates).toContain("5NPE24AF1FH441120");
      expect(r.candidates).toContain("JN8AS5MT9DW441120");
    }
  });

  it("falls through to additional text fields when the memo is empty", () => {
    const r = attributeCharge(
      charge({ memo: null, additionalText: [null, "line item — vehicle 123357"] }),
      INVENTORY,
    );
    expect(r.status).toBe("matched");
    if (r.status === "matched") expect(r.vin).toBe("3VWFE21C04M123357");
  });

  it("categorizes even when it cannot attribute", () => {
    // An unattributed charge still knows what kind of spend it is, so it can
    // be booked to overhead without a second pass.
    const r = attributeCharge(charge({ merchant: "CHEVRON 55", memo: "fuel" }), INVENTORY);
    expect(r.status).toBe("unmatched");
    expect(r.category).toBe("fuel");
  });

  describe("strict mode", () => {
    it("rejects a date that loose mode would accept", () => {
      const c = charge({ memo: "check 100324" });
      expect(attributeCharge(c, INVENTORY, { mode: "loose" }).status).toBe("unmatched");
      const strict = attributeCharge(c, INVENTORY, { mode: "strict" });
      expect(strict.status).toBe("unmatched");
      if (strict.status === "unmatched") expect(strict.reason).toBe("no_vin");
    });

    it("still matches a genuine suffix", () => {
      const r = attributeCharge(charge({ memo: "check 4411 for 565722" }), INVENTORY, { mode: "strict" });
      expect(r.status).toBe("matched");
    });
  });
});

describe("attributeBatch", () => {
  const charges: Charge[] = [
    charge({ id: "a", amount: 120, memo: "pads 565722" }),      // matched
    charge({ id: "b", amount: 80, memo: "filter 123357" }),      // matched
    charge({ id: "c", amount: 4000, memo: "shop supplies" }),    // no_vin, large
    charge({ id: "d", amount: 50, memo: "parts 999999" }),       // not in inventory
    charge({ id: "e", amount: 60, memo: "tires 441120" }),       // ambiguous
  ];

  const { summary } = attributeBatch(charges, INVENTORY);

  it("counts matches", () => {
    expect(summary.total).toBe(5);
    expect(summary.matched).toBe(2);
    expect(summary.unmatched).toBe(3);
    expect(summary.matchRateByCount).toBeCloseTo(0.4);
  });

  it("breaks failures down by reason", () => {
    expect(summary.byReason.no_vin.count).toBe(1);
    expect(summary.byReason.vin_not_in_inventory.count).toBe(1);
    expect(summary.byReason.ambiguous_vin.count).toBe(1);
  });

  it("reports value separately from count, because they diverge", () => {
    // 40% of charges matched but only ~5% of dollars did, because the single
    // large charge is the one that failed. That gap is the finding: chasing
    // the long tail of small charges would move the count rate and nothing
    // that matters. One $4,000 memo is the whole problem.
    expect(summary.matchRateByCount).toBeCloseTo(0.4);
    expect(summary.matchRateByValue).toBeLessThan(0.06);
    expect(summary.byReason.no_vin.value).toBe(4000);
  });

  it("handles an empty batch without dividing by zero", () => {
    const { summary: empty } = attributeBatch([], INVENTORY);
    expect(empty.total).toBe(0);
    expect(empty.matchRateByCount).toBe(0);
    expect(empty.matchRateByValue).toBe(0);
  });
});
