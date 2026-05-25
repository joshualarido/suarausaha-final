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
      paymentAccounts: [{ id: "acct_cash", name: "Kas", type: "cash", isDefault: true }],
      menuItems: [],
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
      paymentAccounts: [{ id: "acct_cash", name: "Kas", type: "cash", isDefault: true }],
      menuItems: [],
    });

    expect(result.status).toBe("needs_clarification");
    expect(result.missingFields).toContain("amount");
    expect(result.proposedAction).toBeNull();
  });

  it("uses a clear active menu item price when sales text includes quantity and item", async () => {
    const parser = createDeterministicIntentParser();

    const result = await parser.parse({
      message: "Jual 2 ayam geprek tunai",
      businessId: "biz_123",
      userId: "user_123",
      today: "2026-05-23",
      defaultPaymentAccountId: "acct_cash",
      defaultPaymentAccountName: "Kas",
      paymentAccounts: [{ id: "acct_cash", name: "Kas", type: "cash", isDefault: true }],
      menuItems: [
        {
          id: "menu_ayam_geprek",
          name: "Ayam Geprek",
          aliases: ["geprek"],
          defaultPrice: 15_000,
          category: "Makanan",
        },
      ],
    });

    expect(result.status).toBe("parsed");
    expect(result.proposedAction).toMatchObject({
      intent: "sales_income",
      amount: 30_000,
      affectedObject: "Ayam Geprek",
      warning: "Nominal dihitung dari 2 x harga menu Ayam Geprek. Periksa lagi sebelum konfirmasi.",
    });
  });

  it("asks for clarification when a menu item match has no default price", async () => {
    const parser = createDeterministicIntentParser();

    const result = await parser.parse({
      message: "Jual 2 ayam geprek tunai",
      businessId: "biz_123",
      userId: "user_123",
      today: "2026-05-23",
      defaultPaymentAccountId: "acct_cash",
      defaultPaymentAccountName: "Kas",
      paymentAccounts: [{ id: "acct_cash", name: "Kas", type: "cash", isDefault: true }],
      menuItems: [
        {
          id: "menu_ayam_geprek",
          name: "Ayam Geprek",
          aliases: ["geprek"],
          defaultPrice: null,
          category: "Makanan",
        },
      ],
    });

    expect(result.status).toBe("needs_clarification");
    expect(result.missingFields).toContain("amount");
  });

  it("asks for clarification when multiple menu items match the same sales text", async () => {
    const parser = createDeterministicIntentParser();

    const result = await parser.parse({
      message: "Jual 2 ayam tunai",
      businessId: "biz_123",
      userId: "user_123",
      today: "2026-05-23",
      defaultPaymentAccountId: "acct_cash",
      defaultPaymentAccountName: "Kas",
      paymentAccounts: [{ id: "acct_cash", name: "Kas", type: "cash", isDefault: true }],
      menuItems: [
        {
          id: "menu_ayam_geprek",
          name: "Ayam Geprek",
          aliases: ["ayam"],
          defaultPrice: 15_000,
          category: "Makanan",
        },
        {
          id: "menu_ayam_bakar",
          name: "Ayam Bakar",
          aliases: ["ayam"],
          defaultPrice: 18_000,
          category: "Makanan",
        },
      ],
    });

    expect(result.status).toBe("needs_clarification");
    expect(result.missingFields).toContain("menu_item");
  });
});
