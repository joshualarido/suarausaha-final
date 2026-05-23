import { describe, expect, it } from "vitest";

import { createDeterministicIntentParser } from "../src/features/parser/deterministic-parser.service.js";

describe("deterministic intent parser", () => {
  it("returns structured sales income without writing financial data", async () => {
    const parser = createDeterministicIntentParser();

    const result = await parser.parse({
      message: "Jual ayam geprek 500 ribu tunai",
      businessId: "biz_123",
      userId: "user_123",
      today: "2026-05-23",
      defaultPaymentAccountId: "acct_cash",
      defaultPaymentAccountName: "Kas",
    });

    expect(result.status).toBe("parsed");
    expect(result.proposedAction).toMatchObject({
      intent: "sales_income",
      amount: 500_000,
      date: "2026-05-23",
      paymentAccountId: "acct_cash",
      paymentAccountName: "Kas",
    });
    expect(result.proposedAction?.expectedEffects).toEqual([
      "Kas bertambah Rp500.000",
      "Pendapatan bertambah Rp500.000",
    ]);
  });

  it("asks for clarification instead of inventing an amount", async () => {
    const parser = createDeterministicIntentParser();

    const result = await parser.parse({
      message: "Jual ayam geprek tunai",
      businessId: "biz_123",
      userId: "user_123",
      today: "2026-05-23",
      defaultPaymentAccountId: "acct_cash",
      defaultPaymentAccountName: "Kas",
    });

    expect(result.status).toBe("needs_clarification");
    expect(result.missingFields).toContain("amount");
    expect(result.proposedAction).toBeNull();
  });
});
