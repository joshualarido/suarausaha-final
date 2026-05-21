import { describe, expect, it } from "vitest";
import { previewOpeningBalance } from "../src/features/opening-balance/opening-balance.service.js";

describe("opening balance service", () => {
  it("calculates opening equity from opening assets and liabilities", () => {
    const result = previewOpeningBalance({
      cashBalance: 500_000,
      nonCashBalance: 1_000_000,
      inventoryValue: 300_000,
      assetValue: 2_000_000,
      debtValue: 400_000,
      receivableValue: 150_000,
    });

    expect(result.openingAssets).toBe(3_950_000);
    expect(result.openingLiabilities).toBe(400_000);
    expect(result.openingEquity).toBe(3_550_000);
  });
});
