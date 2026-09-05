export { extractVin6Loose, extractVin6Strict, vinEndsWith } from "./vin.js";
export { normalizeMerchant, categorize } from "./merchant.js";
export type { CostCategory, CategorizableCharge } from "./merchant.js";
export { attributeCharge, attributeBatch } from "./attribute.js";
export type {
  Charge, Vehicle, AttributionResult, AttributionSummary,
  UnmatchedReason, AttributeOptions,
} from "./attribute.js";
