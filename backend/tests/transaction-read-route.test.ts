import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/features/auth/auth.js", () => {
  return {
    auth: {
      api: {
        getSession: vi.fn(),
      },
    },
  };
});

vi.mock("../src/features/business/business.service.js", () => {
  return {
    findBusinessByOwnerId: vi.fn(),
    getBusinessOnboardingContextForOwner: vi.fn(),
    createBusinessForOwner: vi.fn(),
    resetBusinessForOwner: vi.fn(),
    updateBusinessNameForOwner: vi.fn(),
  };
});

vi.mock("../src/features/transactions/transaction.service.js", () => {
  return {
    TRANSACTION_TYPES: [
      "sales_income",
      "general_expense",
      "inventory_purchase_value",
      "asset_record_or_purchase",
      "liability_created",
      "liability_payment",
      "receivable_created",
      "receivable_payment",
      "owner_capital_contribution",
      "owner_withdrawal",
      "account_transfer",
      "reversal",
    ],
    listTransactionHistoryByBusinessId: vi.fn(),
    getInventorySummaryByBusinessId: vi.fn(),
    getAssetSummaryByBusinessId: vi.fn(),
    getLiabilitySummaryByBusinessId: vi.fn(),
    getReceivableSummaryByBusinessId: vi.fn(),
    getTransactionDetailByBusinessId: vi.fn(),
  };
});

import { app } from "../src/app.js";
import { auth } from "../src/features/auth/auth.js";
import { findBusinessByOwnerId } from "../src/features/business/business.service.js";
import {
  getAssetSummaryByBusinessId,
  getInventorySummaryByBusinessId,
  getLiabilitySummaryByBusinessId,
  getReceivableSummaryByBusinessId,
  getTransactionDetailByBusinessId,
  listTransactionHistoryByBusinessId,
} from "../src/features/transactions/transaction.service.js";

describe("transaction read routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: {
        id: "user_123",
        name: "Josh",
        email: "josh@example.com",
      },
      session: {
        id: "session_123",
        userId: "user_123",
        expiresAt: new Date(),
      },
    } as never);

    vi.mocked(findBusinessByOwnerId).mockResolvedValue({
      id: "biz_123",
      ownerId: "user_123",
      name: "Warung Test",
      currency: "IDR",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
  });

  it("returns paginated transaction history for the authenticated business", async () => {
    vi.mocked(listTransactionHistoryByBusinessId).mockResolvedValue({
      items: [
        {
          id: "txn_1",
          type: "sales_income",
          amount: 120_000,
          date: "2026-05-24",
          description: "Jual nasi uduk",
          status: "confirmed",
          isReversed: false,
          affectedObject: null,
          paymentAccount: {
            id: "acct_cash",
            name: "Kas",
          },
          cashDirection: "in",
          createdAt: new Date("2026-05-24T10:00:00Z"),
        },
      ],
      page: 2,
      limit: 10,
      total: 11,
    } as never);

    const response = await request(app).get("/api/v1/transactions?page=2&limit=10&type=sales_income");

    expect(response.status).toBe(200);
    expect(listTransactionHistoryByBusinessId).toHaveBeenCalledWith({
      businessId: "biz_123",
      page: 2,
      limit: 10,
      type: "sales_income",
      sortBy: "date",
      sortDirection: "desc",
    });
    expect(response.body.success).toBe(true);
    expect(response.body.data.total).toBe(11);
    expect(response.body.data.items[0].cashDirection).toBe("in");
  });

  it("passes transaction sort options to the history service", async () => {
    vi.mocked(listTransactionHistoryByBusinessId).mockResolvedValue({
      items: [],
      page: 1,
      limit: 20,
      total: 0,
    } as never);

    const response = await request(app).get("/api/v1/transactions?sortBy=amount&sortDirection=asc");

    expect(response.status).toBe(200);
    expect(listTransactionHistoryByBusinessId).toHaveBeenCalledWith({
      businessId: "biz_123",
      page: 1,
      limit: 20,
      sortBy: "amount",
      sortDirection: "asc",
    });
  });

  it("returns validation error for invalid transaction query", async () => {
    const response = await request(app).get("/api/v1/transactions?page=0");

    expect(response.status).toBe(400);
    expect(listTransactionHistoryByBusinessId).not.toHaveBeenCalled();
  });

  it("returns validation error for invalid transaction sort options", async () => {
    const response = await request(app).get("/api/v1/transactions?sortBy=paymentAccount&sortDirection=sideways");

    expect(response.status).toBe(400);
    expect(listTransactionHistoryByBusinessId).not.toHaveBeenCalled();
  });

  it("returns transaction detail with audit fields and sales inventory limitation note", async () => {
    vi.mocked(getTransactionDetailByBusinessId).mockResolvedValue({
      id: "txn_sales_1",
      type: "sales_income",
      amount: 500_000,
      date: "2026-06-05",
      description: "Jual ayam geprek 500 ribu tunai",
      status: "confirmed",
      isReversed: false,
      cashDirection: "in",
      affectedObject: "Ayam Geprek",
      paymentAccount: { id: "acct_cash", name: "Kas" },
      captureMode: "auto_fast",
      rawInputText: "Jual ayam geprek 500 ribu tunai",
      interpretedAction: {
        intent: "sales_income",
        amount: 500_000,
        date: "2026-06-05",
        paymentAccountName: "Kas",
        description: "Jual ayam geprek 500 ribu tunai",
      },
      expectedEffects: ["Kas bertambah Rp500.000", "Pendapatan bertambah Rp500.000"],
      effects: [
        {
          targetType: "payment_account",
          effectType: "payment_account_change",
          direction: "increase",
          amount: 500_000,
          beforeAmount: 0,
          afterAmount: 500_000,
        },
        {
          targetType: "business_bucket",
          effectType: "income",
          direction: "increase",
          amount: 500_000,
          beforeAmount: 0,
          afterAmount: 500_000,
        },
      ],
      notes: ["Penjualan tidak otomatis mengurangi stok."],
      inventoryDecrease: {
        hasDecrease: false,
        amount: 0,
      },
      createdAt: new Date("2026-06-05T10:00:00Z"),
    } as never);

    const response = await request(app).get("/api/v1/transactions/txn_sales_1");

    expect(response.status).toBe(200);
    expect(getTransactionDetailByBusinessId).toHaveBeenCalledWith({
      businessId: "biz_123",
      transactionId: "txn_sales_1",
    });
    expect(response.body.data).toMatchObject({
      id: "txn_sales_1",
      rawInputText: "Jual ayam geprek 500 ribu tunai",
      captureMode: "auto_fast",
      status: "confirmed",
      paymentAccount: { name: "Kas" },
      inventoryDecrease: {
        hasDecrease: false,
        amount: 0,
      },
      notes: ["Penjualan tidak otomatis mengurangi stok."],
    });
  });

  it("returns 404 for missing transaction detail", async () => {
    vi.mocked(getTransactionDetailByBusinessId).mockResolvedValue(null as never);

    const response = await request(app).get("/api/v1/transactions/missing_txn");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Transaction not found.",
      },
    });
  });

  it("returns inventory summary", async () => {
    vi.mocked(getInventorySummaryByBusinessId).mockResolvedValue({
      estimatedValue: 450_000,
      openingValue: 100_000,
      purchasedValue: 350_000,
      lastUpdatedAt: new Date("2026-05-25T09:00:00Z"),
      note: "Nilai persediaan masih berupa estimasi.",
    } as never);

    const response = await request(app).get("/api/v1/inventory-summary");

    expect(response.status).toBe(200);
    expect(getInventorySummaryByBusinessId).toHaveBeenCalledWith("biz_123");
    expect(response.body.data.estimatedValue).toBe(450000);
  });

  it("returns asset summary", async () => {
    vi.mocked(getAssetSummaryByBusinessId).mockResolvedValue({
      totalAssetValue: 2_000_000,
      openingValue: 1_500_000,
      purchasedOrRecordedValue: 500_000,
      items: [
        {
          id: "asset-from-txn_123",
          name: "Kompor",
          value: 500_000,
          recordedDate: "2026-05-24",
          sourceTransactionId: "txn_123",
        },
      ],
    } as never);

    const response = await request(app).get("/api/v1/asset-summary");

    expect(response.status).toBe(200);
    expect(getAssetSummaryByBusinessId).toHaveBeenCalledWith("biz_123");
    expect(response.body.data.items).toHaveLength(1);
  });

  it("returns liabilities summary", async () => {
    vi.mocked(getLiabilitySummaryByBusinessId).mockResolvedValue({
      totalOriginalAmount: 1_000_000,
      totalOutstandingAmount: 700_000,
      items: [
        {
          id: "liability-1",
          lenderName: "Supplier",
          originalAmount: 1_000_000,
          outstandingAmount: 700_000,
          status: "partial",
          createdDate: "2026-05-24",
          sourceTransactionId: "txn_321",
        },
      ],
    } as never);

    const response = await request(app).get("/api/v1/liabilities");

    expect(response.status).toBe(200);
    expect(getLiabilitySummaryByBusinessId).toHaveBeenCalledWith("biz_123");
    expect(response.body.data.totalOutstandingAmount).toBe(700000);
  });

  it("returns receivables summary", async () => {
    vi.mocked(getReceivableSummaryByBusinessId).mockResolvedValue({
      totalOriginalAmount: 500_000,
      totalPaidAmount: 200_000,
      totalOutstandingAmount: 300_000,
      items: [
        {
          id: "receivable-1",
          customerName: "Budi",
          originalAmount: 500_000,
          paidAmount: 200_000,
          outstandingAmount: 300_000,
          remainingAmount: 300_000,
          status: "partial",
          createdDate: "2026-05-24",
          sourceTransactionId: "txn_654",
        },
      ],
    } as never);

    const response = await request(app).get("/api/v1/receivables");

    expect(response.status).toBe(200);
    expect(getReceivableSummaryByBusinessId).toHaveBeenCalledWith("biz_123");
    expect(response.body.data.totalPaidAmount).toBe(200000);
    expect(response.body.data.totalOutstandingAmount).toBe(300000);
    expect(response.body.data.items[0]).toMatchObject({
      customerName: "Budi",
      originalAmount: 500000,
      paidAmount: 200000,
      remainingAmount: 300000,
      status: "partial",
    });
  });

  it("returns 404 if authenticated user has no business", async () => {
    vi.mocked(findBusinessByOwnerId).mockResolvedValue(null as never);

    const response = await request(app).get("/api/v1/transactions");

    expect(response.status).toBe(404);
    expect(listTransactionHistoryByBusinessId).not.toHaveBeenCalled();
  });
});
