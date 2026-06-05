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

  it("calculates opening equity from itemized opening balance rows", () => {
    const result = previewOpeningBalance({
      paymentAccounts: [
        { name: "Kas", type: "cash", openingBalance: 1_000_000 },
        { name: "Bank BCA", type: "non_cash", openingBalance: 300_000 },
        { name: "QRIS", type: "non_cash", openingBalance: 200_000 },
      ],
      inventoryItems: [{ name: "Stok awal bahan baku", value: 300_000 }],
      assetItems: [{ name: "Peralatan awal", value: 2_000_000 }],
      liabilityItems: [{ lenderName: "Supplier ayam", amount: 700_000 }],
      receivableItems: [{ customerName: "Budi", amount: 200_000 }],
    });

    expect(result.cashBalance).toBe(1_000_000);
    expect(result.nonCashBalance).toBe(500_000);
    expect(result.inventoryValue).toBe(300_000);
    expect(result.assetValue).toBe(2_000_000);
    expect(result.debtValue).toBe(700_000);
    expect(result.receivableValue).toBe(200_000);
    expect(result.openingAssets).toBe(4_000_000);
    expect(result.openingLiabilities).toBe(700_000);
    expect(result.openingEquity).toBe(3_300_000);
  });
});
