import { describe, expect, it } from "vitest";

import { createDeterministicIntentParser } from "../src/features/parser/deterministic-parser.service.js";

describe("deterministic intent parser", () => {
  it("asks user to create menu data first when sales menu catalog is empty", async () => {
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

    expect(result.status).toBe("needs_clarification");
    expect(result.missingFields).toContain("menu_item_dependency");
    expect(result.question).toContain("Buat menu dulu di Katalog");
  });

  it("assumes quantity 1 from catalog price when sales amount is omitted", async () => {
    const parser = createDeterministicIntentParser();

    const result = await parser.parse({
      message: "Jual ayam geprek tunai",
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
      amount: 15_000,
      affectedObject: "Ayam Geprek",
      warning: "Nominal diasumsikan 1 x harga menu Ayam Geprek. Periksa lagi sebelum disimpan.",
    });
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
      warning: "Nominal dihitung dari 2 x harga menu Ayam Geprek. Periksa lagi sebelum disimpan.",
    });
  });

  it("builds a multi-item POS sales order from catalog prices", async () => {
    const parser = createDeterministicIntentParser();

    const result = await parser.parse({
      message: "Jual 2 ayam geprek and 2 es teh tunai",
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
        {
          id: "menu_es_teh",
          name: "Es Teh",
          aliases: ["esteh"],
          defaultPrice: 5_000,
          category: "Minuman",
        },
      ],
    });

    expect(result.status).toBe("parsed");
    expect(result.proposedAction).toMatchObject({
      intent: "sales_income",
      amount: 40_000,
      affectedObject: "Ayam Geprek, Es Teh",
      salesOrder: {
        status: "draft",
        totalAmount: 40_000,
        lines: [
          expect.objectContaining({
            productId: "menu_ayam_geprek",
            quantity: 2,
            subtotal: 30_000,
          }),
          expect.objectContaining({
            productId: "menu_es_teh",
            quantity: 2,
            subtotal: 10_000,
          }),
        ],
      },
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

  it("prefers cash account when message says tunai even if default account is non-cash", async () => {
    const parser = createDeterministicIntentParser();

    const result = await parser.parse({
      message: "Jual ayam geprek tunai",
      businessId: "biz_123",
      userId: "user_123",
      today: "2026-05-23",
      defaultPaymentAccountId: "acct_bank",
      defaultPaymentAccountName: "BCA",
      paymentAccounts: [
        { id: "acct_bank", name: "BCA", type: "non_cash", isDefault: true },
        { id: "acct_cash", name: "Kas", type: "cash", isDefault: false },
      ],
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
      paymentAccountId: "acct_cash",
      paymentAccountName: "Kas",
    });
  });

  it("asks whether an ambiguous bahan purchase is inventory or direct expense", async () => {
    const parser = createDeterministicIntentParser();

    const result = await parser.parse({
      message: "beli bahan masak 50 ribu pakai kas tanggal 4 Juni 2026",
      businessId: "biz_123",
      userId: "user_123",
      today: "2026-06-05",
      defaultPaymentAccountId: "acct_cash",
      defaultPaymentAccountName: "Kas",
      paymentAccounts: [{ id: "acct_cash", name: "Kas", type: "cash", isDefault: true }],
      menuItems: [],
    });

    expect(result.status).toBe("needs_clarification");
    expect(result.question).toBe("Ini mau dicatat sebagai stok/persediaan atau sebagai biaya langsung?");
    expect(result.options).toEqual([
      { label: "Stok / Persediaan", value: "inventory_purchase_value" },
      { label: "Biaya langsung", value: "general_expense" },
    ]);
  });

  it("parses account transfers with source and destination payment accounts", async () => {
    const parser = createDeterministicIntentParser();

    const result = await parser.parse({
      message: "pindah 200 ribu dari Kas ke BCA",
      businessId: "biz_123",
      userId: "user_123",
      today: "2026-06-06",
      defaultPaymentAccountId: "acct_cash",
      defaultPaymentAccountName: "Kas",
      paymentAccounts: [
        { id: "acct_cash", name: "Kas", type: "cash", isDefault: true },
        { id: "acct_bca", name: "BCA", type: "non_cash", isDefault: false },
      ],
      menuItems: [],
    });

    expect(result.status).toBe("parsed");
    expect(result.proposedAction).toMatchObject({
      intent: "account_transfer",
      amount: 200_000,
      paymentAccountId: "acct_cash",
      paymentAccountName: "Kas",
      destinationPaymentAccountId: "acct_bca",
      destinationPaymentAccountName: "BCA",
      expectedEffects: ["Kas berkurang Rp200.000", "BCA bertambah Rp200.000"],
      warning: "Saldo akun asal akan diperiksa lagi sebelum disimpan.",
    });
  });

  it.each([
    ["bayar listrik 100 ribu pakai kas", "general_expense", "Listrik"],
    ["beli kompor usaha 800 ribu pakai kas", "asset_record_or_purchase", "Kompor Usaha"],
    ["pinjam uang usaha 2 juta dari Pak Budi masuk kas", "liability_created", "Pak Budi"],
    ["bayar utang Supplier Ayam 200 ribu pakai kas", "liability_payment", "Supplier Ayam"],
    ["Budi belum bayar 100 ribu", "receivable_created", "Budi"],
    ["Budi bayar piutang 100 ribu tunai", "receivable_payment", "Budi"],
    ["tambah modal 1 juta masuk kas", "owner_capital_contribution", null],
    ["ambil uang usaha 300 ribu untuk pribadi", "owner_withdrawal", null],
  ] as const)("parses keyword transaction '%s' as %s", async (message, intent, affectedObject) => {
    const parser = createDeterministicIntentParser();

    const result = await parser.parse({
      message,
      businessId: "biz_123",
      userId: "user_123",
      today: "2026-06-06",
      defaultPaymentAccountId: "acct_cash",
      defaultPaymentAccountName: "Kas",
      paymentAccounts: [{ id: "acct_cash", name: "Kas", type: "cash", isDefault: true }],
      menuItems: [],
      openLiabilities: [{ id: "liab_1", lenderName: "Supplier Ayam", description: "Utang stok ayam", outstandingAmount: 250_000 }],
      openReceivables: [{ id: "recv_1", customerName: "Budi", description: "Budi beli tempo", outstandingAmount: 150_000 }],
    });

    expect(result.status).toBe("parsed");
    expect(result.proposedAction).toMatchObject({
      intent,
      amount: expect.any(Number),
      paymentAccountId: intent === "receivable_created" ? null : "acct_cash",
      affectedObject,
    });
  });

  it("asks for the payment target when liability payment target is missing", async () => {
    const parser = createDeterministicIntentParser();

    const result = await parser.parse({
      message: "bayar utang 100 ribu pakai kas",
      businessId: "biz_123",
      userId: "user_123",
      today: "2026-06-06",
      defaultPaymentAccountId: "acct_cash",
      defaultPaymentAccountName: "Kas",
      paymentAccounts: [{ id: "acct_cash", name: "Kas", type: "cash", isDefault: true }],
      menuItems: [],
      openLiabilities: [
        { id: "liab_1", lenderName: "Supplier Ayam", description: "Utang stok ayam", outstandingAmount: 250_000 },
        { id: "liab_2", lenderName: "Pak Budi", description: "Pinjaman modal", outstandingAmount: 500_000 },
      ],
    });

    expect(result.status).toBe("needs_clarification");
    expect(result.missingFields).toContain("affectedObject");
    expect(result.options).toEqual([
      { label: "Supplier Ayam", value: "Supplier Ayam" },
      { label: "Pak Budi", value: "Pak Budi" },
    ]);
  });
});
