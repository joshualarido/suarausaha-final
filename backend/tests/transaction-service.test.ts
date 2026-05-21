import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/financial-write.js", () => {
  return {
    runFinancialWrite: vi.fn(),
  };
});

import { runFinancialWrite } from "../src/lib/financial-write.js";
import {
  createBaseTransaction,
  InvalidTransactionAmountError,
} from "../src/features/transactions/transaction.service.js";

describe("transaction service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects non-positive transaction amounts", async () => {
    await expect(
      createBaseTransaction({
        businessId: "biz_123",
        createdBy: "user_123",
        type: "sales_income",
        amount: 0,
        transactionDate: "2026-05-12",
        description: "Invalid amount",
      }),
    ).rejects.toBeInstanceOf(InvalidTransactionAmountError);
  });

  it("requires description", async () => {
    await expect(
      createBaseTransaction({
        businessId: "biz_123",
        createdBy: "user_123",
        type: "sales_income",
        amount: 10_000,
        transactionDate: "2026-05-12",
        description: "   ",
      }),
    ).rejects.toThrow("Transaction description is required.");
  });

  it("uses financial write transaction wrapper for valid input", async () => {
    vi.mocked(runFinancialWrite).mockResolvedValue({
      id: "txn_123",
      businessId: "biz_123",
      paymentAccountId: "acct_cash",
      type: "sales_income",
      amount: "10000",
      transactionDate: "2026-05-12",
      description: "Jual ayam geprek",
      status: "confirmed",
      isReversal: false,
      reversedAt: null,
      createdAt: new Date("2026-05-12T10:00:00Z"),
      createdBy: "user_123",
    } as never);

    const transaction = await createBaseTransaction({
      businessId: "biz_123",
      createdBy: "user_123",
      type: "sales_income",
      amount: 10_000,
      transactionDate: "2026-05-12",
      description: "Jual ayam geprek",
      paymentAccountId: "acct_cash",
    });

    expect(runFinancialWrite).toHaveBeenCalledOnce();
    expect(transaction.id).toBe("txn_123");
  });
});
