import { describe, expect, it } from "vitest";
import {
  buildNeracaSnapshot,
  toOpeningDetailRows,
  renderNeracaPdf,
  type NeracaEffectRow,
} from "../src/features/neraca/neraca.service.js";
import type { OpeningBalanceRow } from "../src/lib/database.js";

function openingBalance(overrides: Partial<OpeningBalanceRow> = {}): OpeningBalanceRow {
  return {
    id: "opening_123",
    businessId: "biz_123",
    cashBalance: "1000000",
    nonCashBalance: "500000",
    inventoryValue: "750000",
    assetValue: "2000000",
    debtValue: "600000",
    receivableValue: "250000",
    openingAssets: "4500000",
    openingLiabilities: "600000",
    openingEquity: "3900000",
    status: "confirmed",
    confirmedAt: new Date("2026-05-01T08:00:00Z"),
    createdAt: new Date("2026-05-01T08:00:00Z"),
    updatedAt: new Date("2026-05-01T08:00:00Z"),
    ...overrides,
  };
}

function effect(overrides: Partial<NeracaEffectRow>): NeracaEffectRow {
  return {
    targetType: "business_bucket",
    targetId: "income",
    effectType: "income",
    direction: "increase",
    amount: "0",
    transactionDate: "2026-05-12",
    paymentAccountName: null,
    paymentAccountType: null,
    inventoryName: null,
    assetName: null,
    liabilityName: null,
    receivableName: null,
    ...overrides,
  };
}

function buildReport(effectRows: NeracaEffectRow[] = []) {
  return buildNeracaSnapshot(openingBalance(), effectRows, {
    businessId: "biz_123",
    userId: "user_123",
    reportDate: "2026-05-31",
    generatedAt: new Date("2026-05-31T10:00:00Z"),
    generatedByName: "Josh",
  });
}

describe("neraca service calculation", () => {
  it("builds a balanced opening-balance-only neraca", () => {
    const report = buildReport();

    expect(report.aktiva.total).toBe(4_500_000);
    expect(report.utang.total).toBe(600_000);
    expect(report.ekuitas.total).toBe(3_900_000);
    expect(report.equation.totalPasiva).toBe(4_500_000);
    expect(report.equation.reconciliationStatus).toBe("seimbang");
    expect(report.warningText).toBeNull();
  });

  it("uses named opening detail rows without double counting aggregate opening values", () => {
    const report = buildNeracaSnapshot(
      openingBalance({
        inventoryValue: "300000",
        assetValue: "2000000",
        debtValue: "700000",
        receivableValue: "200000",
        openingAssets: "4000000",
        openingLiabilities: "700000",
        openingEquity: "3300000",
      }),
      [],
      {
        businessId: "biz_123",
        userId: "user_123",
        reportDate: "2026-05-31",
        generatedAt: new Date("2026-05-31T10:00:00Z"),
        generatedByName: "Josh",
      },
      {
        inventoryItems: [{ label: "Stok awal bahan baku", amount: 300_000 }],
        assetItems: [{ label: "Peralatan awal", amount: 2_000_000 }],
        liabilityItems: [{ label: "Supplier ayam", amount: 700_000 }],
        receivableItems: [{ label: "Budi", amount: 200_000 }],
      },
    );

    expect(report.aktiva.total).toBe(4_000_000);
    expect(report.aktiva.inventory.items).toEqual([{ label: "Stok awal bahan baku", amount: 300_000 }]);
    expect(report.aktiva.fixedAssets.items).toEqual([{ label: "Peralatan awal", amount: 2_000_000 }]);
    expect(report.utang.groups[0].items).toEqual([{ label: "Supplier ayam", amount: 700_000 }]);
    expect(report.equation.totalPasiva).toBe(4_000_000);
    expect(report.equation.isBalanced).toBe(true);
  });

  it("uses original opening liability and receivable amounts before applying payment effects", () => {
    const details = toOpeningDetailRows({
      inventoryRows: [],
      assetRows: [],
      liabilityRows: [
        {
          lenderName: "Supplier ayam",
          originalAmount: "700000",
          outstandingAmount: "500000",
        },
      ],
      receivableRows: [
        {
          customerName: "Budi",
          originalAmount: "400000",
          outstandingAmount: "250000",
        },
      ],
    });

    expect(details.liabilityItems).toEqual([{ label: "Supplier ayam", amount: 700_000 }]);
    expect(details.receivableItems).toEqual([{ label: "Budi", amount: 400_000 }]);
  });

  it("reports opening liability and receivable balances after payments without double subtracting", () => {
    const report = buildNeracaSnapshot(
      openingBalance({
        cashBalance: "300000",
        nonCashBalance: "0",
        inventoryValue: "0",
        assetValue: "0",
        debtValue: "700000",
        receivableValue: "400000",
        openingAssets: "700000",
        openingLiabilities: "700000",
        openingEquity: "0",
      }),
      [
        effect({ targetType: "payment_account", targetId: "cash", paymentAccountType: "cash", direction: "decrease", amount: "200000" }),
        effect({ targetType: "liability", targetId: "liability_supplier", liabilityName: "Supplier ayam", direction: "decrease", amount: "200000" }),
        effect({ targetType: "payment_account", targetId: "cash", paymentAccountType: "cash", direction: "increase", amount: "100000" }),
        effect({ targetType: "receivable", targetId: "receivable_budi", receivableName: "Budi", direction: "decrease", amount: "100000" }),
      ],
      {
        businessId: "biz_123",
        userId: "user_123",
        reportDate: "2026-06-04",
        generatedAt: new Date("2026-06-04T10:00:00Z"),
        generatedByName: "Josh",
      },
      {
        inventoryItems: [],
        assetItems: [],
        liabilityItems: [{ label: "Supplier ayam", amount: 700_000 }],
        receivableItems: [{ label: "Budi", amount: 400_000 }],
      },
    );

    expect(report.utang.total).toBe(500_000);
    expect(report.aktiva.currentAssets.items).toEqual([
      { label: "Kas", amount: 200_000 },
      { label: "Bank / QRIS / E-wallet", amount: 0 },
      { label: "Piutang Usaha", amount: 300_000 },
    ]);
    expect(report.equation.isBalanced).toBe(true);
  });

  it("applies confirmed transaction effects to assets, debt, and equity", () => {
    const report = buildReport([
      effect({ targetType: "payment_account", targetId: "cash", paymentAccountType: "cash", direction: "increase", amount: "500000" }),
      effect({ targetType: "business_bucket", targetId: "income", effectType: "income", amount: "500000" }),
      effect({ targetType: "payment_account", targetId: "cash", paymentAccountType: "cash", direction: "decrease", amount: "100000" }),
      effect({ targetType: "business_bucket", targetId: "expense", effectType: "expense", amount: "100000" }),
      effect({ targetType: "liability", targetId: "debt_1", liabilityName: "Supplier Ayam", direction: "increase", amount: "300000" }),
      effect({ targetType: "payment_account", targetId: "bank", paymentAccountType: "non_cash", direction: "increase", amount: "300000" }),
    ]);

    expect(report.aktiva.total).toBe(5_200_000);
    expect(report.utang.total).toBe(900_000);
    expect(report.ekuitas.runningProfit).toBe(400_000);
    expect(report.ekuitas.total).toBe(4_300_000);
    expect(report.equation.isBalanced).toBe(true);
  });

  it("nets reversal effects when the reversal is included in the report rows", () => {
    const report = buildReport([
      effect({ targetType: "payment_account", targetId: "cash", paymentAccountType: "cash", direction: "increase", amount: "500000" }),
      effect({ targetType: "business_bucket", targetId: "income", effectType: "income", amount: "500000" }),
      effect({ targetType: "payment_account", targetId: "cash", paymentAccountType: "cash", direction: "decrease", amount: "500000" }),
      effect({ targetType: "business_bucket", targetId: "income", effectType: "income", direction: "decrease", amount: "500000" }),
    ]);

    expect(report.aktiva.total).toBe(4_500_000);
    expect(report.ekuitas.runningProfit).toBe(0);
    expect(report.equation.isBalanced).toBe(true);
  });

  it("marks unbalanced reports with a warning", () => {
    const report = buildReport([
      effect({ targetType: "payment_account", targetId: "cash", paymentAccountType: "cash", direction: "increase", amount: "500000" }),
    ]);

    expect(report.equation.isBalanced).toBe(false);
    expect(report.equation.difference).toBe(500_000);
    expect(report.warningText).toContain("belum seimbang");
  });

  it("renders PDF bytes from saved snapshot data", () => {
    const report = {
      ...buildReport(),
      id: "neraca_123",
      createdAt: new Date("2026-05-31T10:00:00Z"),
    };

    const pdf = renderNeracaPdf(report);

    expect(pdf.toString("utf8", 0, 8)).toBe("%PDF-1.4");
    expect(pdf.toString("utf8")).toContain("Laporan Neraca");
  });
});
