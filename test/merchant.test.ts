import { describe, it, expect } from "vitest";
import { normalizeMerchant, categorize } from "../src/merchant.js";

describe("normalizeMerchant", () => {
  it("collapses the same vendor's many descriptors to one key", () => {
    // These four arrive from the card network as different strings.
    // A rule keyed on the raw text would need four rules; this needs one.
    const variants = ["SHELL 57543431704", "SHELL #221", "PY *SHELL", "Shell  "];
    const keys = new Set(variants.map(normalizeMerchant));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe("shell");
  });

  it("LIMITATION: extra descriptive words are not collapsed", () => {
    // Store numbers, processor prefixes and corporate suffixes are noise and
    // get stripped. "OIL" is a real word in the merchant's name, and the
    // normalizer has no way to know it is not load-bearing — "Shell Oil" and
    // "Shell" become different keys.
    //
    // Left as-is on purpose. Fixing it needs a vendor alias table, which is
    // worth building when merchant rules start missing, not before. The cost
    // of the miss is one extra rule; the cost of over-collapsing is two
    // genuinely different vendors sharing a category.
    expect(normalizeMerchant("PY *SHELL OIL CO.")).toBe("shell oil");
    expect(normalizeMerchant("SHELL #221")).toBe("shell");
  });

  it("strips payment-processor prefixes", () => {
    expect(normalizeMerchant("PY *MERCEDES-BENZ")).toBe("mercedes benz");
    expect(normalizeMerchant("TST* THE DINER")).toBe("the diner");
    expect(normalizeMerchant("SQ *CORNER SHOP")).toBe("corner shop");
  });

  it("strips corporate suffixes", () => {
    expect(normalizeMerchant("ACME AUTO PARTS LLC")).toBe("acme auto parts");
    expect(normalizeMerchant("Wheelworks Inc")).toBe("wheelworks");
  });

  it("drops .com so web and physical descriptors converge", () => {
    expect(normalizeMerchant("ALLDATA.COM")).toBe("alldata");
    expect(normalizeMerchant("ALLDATA")).toBe("alldata");
  });

  it("survives empty and null input", () => {
    expect(normalizeMerchant("")).toBe("");
    expect(normalizeMerchant(null)).toBe("");
    expect(normalizeMerchant(undefined)).toBe("");
  });

  it("is stable — normalizing twice changes nothing", () => {
    const once = normalizeMerchant("PY *SHELL OIL CO. #4471");
    expect(normalizeMerchant(once)).toBe(once);
  });
});

describe("categorize", () => {
  it("reads every free-text field, not just the merchant", () => {
    expect(categorize({ merchant: "UNKNOWN VENDOR", memo: "new front bumper" })).toBe("body");
    expect(categorize({ merchant: "UNKNOWN", merchantCategory: "Towing" })).toBe("transport");
  });

  it("classifies the common cases", () => {
    expect(categorize({ merchant: "O'REILLY AUTO PARTS" })).toBe("parts");
    expect(categorize({ merchant: "CHEVRON 2201" })).toBe("fuel");
    expect(categorize({ merchant: "COUNTY TAX OFFICE", memo: "title and registration" })).toBe("title");
    expect(categorize({ merchant: "SUDS CAR WASH" })).toBe("detail");
  });

  it("applies rule precedence deliberately", () => {
    // A tow invoice often says "service" too. Transport is the more specific
    // intent and is evaluated first, so it wins over recon.
    expect(categorize({ merchant: "CITYWIDE TOWING", memo: "roadside service" })).toBe("transport");
  });

  it("returns 'other' rather than guessing", () => {
    // A wrong category silently distorts per-vehicle margin. "other" is
    // visibly incomplete, so somebody fixes it.
    expect(categorize({ merchant: "AMAZON MKTPL" })).toBe("other");
    expect(categorize({})).toBe("other");
  });
});
