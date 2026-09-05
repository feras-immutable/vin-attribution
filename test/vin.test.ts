import { describe, it, expect } from "vitest";
import { extractVin6Loose, extractVin6Strict, vinEndsWith } from "../src/vin.js";

describe("extractVin6Loose — memos typed on a phone", () => {
  it("accepts a memo that is nothing but the suffix", () => {
    expect(extractVin6Loose("565722")).toBe("565722");
    expect(extractVin6Loose("  0190AB  ")).toBe("0190AB");
  });

  it("finds a suffix inside a description", () => {
    expect(extractVin6Loose("kia sorento 565722")).toBe("565722");
    expect(extractVin6Loose("brake pads for 4T1B21")).toBe("4T1B21");
  });

  it("prefers the LAST candidate — the VIN trails the description", () => {
    // "123456" is the work order, "565722" is the vehicle.
    expect(extractVin6Loose("wo 123456 vehicle 565722")).toBe("565722");
  });

  it("recovers a suffix jammed onto a label with no separator", () => {
    expect(extractVin6Loose("Memo123357")).toBe("123357");
    expect(extractVin6Loose("parts565722")).toBe("565722");
  });

  it("does NOT slice a six-letter tail off an English word", () => {
    // This is the entire reason strategy 3 is restricted to digits.
    // An alphabetic tail would return "ISSION" here — VIN-legal, and wrong.
    expect(extractVin6Loose("transmission")).toBeNull();
    expect(extractVin6Loose("replaced the alternator")).toBeNull();
  });

  it("returns null when there is nothing VIN-shaped", () => {
    expect(extractVin6Loose("new tires")).toBeNull();
    expect(extractVin6Loose("")).toBeNull();
    expect(extractVin6Loose(null)).toBeNull();
    expect(extractVin6Loose(undefined)).toBeNull();
  });

  it("KNOWN FALSE POSITIVE: any six-letter VIN-legal word matches", () => {
    // "CHANGE" is six characters, none of them I, O or Q — indistinguishable
    // from a VIN suffix by shape alone. This is not fixable at the string
    // level; the word is a valid suffix.
    //
    // It is tolerable only because of where loose mode is used. The extracted
    // suffix is then looked up against real inventory, and "CHANGE" matches
    // nothing, so the charge lands in the review queue as
    // `vin_not_in_inventory` instead of being posted to a vehicle. The lookup
    // is the real filter; extraction only has to be cheap and generous.
    expect(extractVin6Loose("oil change")).toBe("CHANGE");
  });

  it("respects the VIN alphabet — I, O and Q are not VIN characters", () => {
    // "MOTION" contains O and I; "MTORS7" contains O. Neither is VIN-legal.
    expect(extractVin6Loose("MOTION")).toBeNull();
    expect(extractVin6Loose("MTORS7")).toBeNull();
    // Same letters minus the O, plus digits — legal.
    expect(extractVin6Loose("MTRS47")).toBe("MTRS47");
  });

  it("uppercases its output so callers can compare directly", () => {
    expect(extractVin6Loose("vin abc123")).toBe("ABC123");
  });
});

describe("extractVin6Strict — memos typed at a desk", () => {
  it("accepts an ordinary suffix", () => {
    expect(extractVin6Strict("check for 565722")).toBe("565722");
  });

  it("rejects date-shaped numbers", () => {
    // 100324 = Oct 3 2024. Common in check memos, never a VIN.
    expect(extractVin6Strict("invoice 100324")).toBeNull();
    expect(extractVin6Strict("dated 123199")).toBeNull();
  });

  it("rejects round dollar amounts", () => {
    // 250000 = $2,500.00
    expect(extractVin6Strict("deposit 250000")).toBeNull();
    expect(extractVin6Strict("payment 100000")).toBeNull();
  });

  it("still accepts a rejected-looking number if a letter is present", () => {
    // A token containing a letter cannot be a date or a dollar amount,
    // so the false-positive filters do not apply to it.
    expect(extractVin6Strict("invoice 10032A")).toBe("10032A");
  });

  it("skips past a bad candidate to a good one", () => {
    // 100324 is date-like and rejected; 565722 is accepted.
    expect(extractVin6Strict("565722 billed 100324")).toBe("565722");
  });

  it("does not do the jammed-token fallback that loose mode does", () => {
    expect(extractVin6Strict("Memo123357")).toBeNull();
    expect(extractVin6Loose("Memo123357")).toBe("123357"); // contrast
  });
});

describe("the two modes disagree, on purpose", () => {
  it("loose is permissive where strict is suspicious", () => {
    const memo = "check 100324";
    expect(extractVin6Loose(memo)).toBe("100324"); // takes it
    expect(extractVin6Strict(memo)).toBeNull();    // rejects it as a date
  });
});

describe("vinEndsWith", () => {
  it("matches case-insensitively", () => {
    expect(vinEndsWith("1HGCM82633A565722", "565722")).toBe(true);
    expect(vinEndsWith("1hgcm82633a565722", "565722")).toBe(true);
    expect(vinEndsWith("1HGCM82633A565722", "565723")).toBe(false);
  });
});
