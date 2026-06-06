import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GeminiParserDraft } from "../src/features/parser/gemini-parser.types.js";
import type { ParseIntentInput } from "../src/features/parser/parser.types.js";
import { validateParserDraft } from "../src/features/parser/parser-validator.service.js";
import { buildPrompt } from "../src/features/parser/gemini-parser.adapter.js";

const expectedIntentOptions = [
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
];

function baseInput(overrides: Partial<ParseIntentInput> = {}): ParseIntentInput {
  return {
    message: "jual ayam geprek 50000 tunai",
    businessId: "biz_123",
    userId: "user_123",
    today: "2026-05-25",
    defaultPaymentAccountId: "acct_cash",
    defaultPaymentAccountName: "Kas",
    paymentAccounts: [{ id: "acct_cash", name: "Kas", type: "cash", isDefault: true }],
    menuItems: [
      {
        id: "menu_ayam_geprek",
        name: "Ayam Geprek",
        aliases: ["geprek"],
        defaultPrice: 25_000,
        category: "Makanan",
      },
    ],
    openLiabilities: [
      {
        id: "liab_1",
        lenderName: "Supplier Ayam",
        description: "Utang stok ayam",
        outstandingAmount: 200_000,
      },
    ],
    openReceivables: [
      {
        id: "recv_1",
        customerName: "Budi",
        description: "Budi beli tempo",
        outstandingAmount: 150_000,
      },
    ],
    ...overrides,
  };
}

function baseDraft(overrides: Partial<GeminiParserDraft> = {}): GeminiParserDraft {
  return {
    detectedIntent: "sales_income",
    amount: 50_000,
    date: "2026-05-25",
    paymentAccountId: "acct_cash",
    paymentAccountName: "Kas",
    description: "Jual ayam geprek tunai",
    affectedObject: "Ayam Geprek",
    assumptions: [],
    missingFields: [],
    clarificationQuestion: null,
    confidence: 0.9,
    multipleEvents: false,
    ...overrides,
  };
}

describe("Gemini parser prompt", () => {
  it("includes the full intent catalog with labels, required fields, and examples", () => {
    const prompt = JSON.parse(buildPrompt(baseInput())) as {
      intentCatalog: Array<{
        intent: string;
        label: string;
        requiredFields: string[];
        examples: string[];
      }>;
      clarificationRules: string[];
      openLiabilities: Array<{ id: string }>;
      openReceivables: Array<{ id: string }>;
    };

    expect(prompt.intentCatalog.map((item) => item.intent)).toEqual(expectedIntentOptions);
    expect(prompt.intentCatalog).toContainEqual(
      expect.objectContaining({
        intent: "sales_income",
        label: "Pemasukan penjualan",
        requiredFields: expect.arrayContaining(["amount", "date", "description"]),
        examples: expect.arrayContaining(["jual ayam geprek 50000 tunai"]),
      }),
    );
    expect(prompt.clarificationRules).toContain(
      "If the transaction type is unclear, ask: Transaksi ini paling cocok dicatat sebagai apa?",
    );
    expect(prompt.openLiabilities.map((item) => item.id)).toEqual(["liab_1"]);
    expect(prompt.openReceivables.map((item) => item.id)).toEqual(["recv_1"]);
  });
});

describe("Gemini parser draft validation", () => {
  it("turns a valid Gemini sales draft into a confirmation-safe proposed action", () => {
    const result = validateParserDraft(baseInput(), baseDraft(), "gemini-3.1-flash-lite");

    expect(result.status).toBe("parsed");
    expect(result.proposedAction).toMatchObject({
      intent: "sales_income",
      amount: 50_000,
      date: "2026-05-25",
      paymentAccountId: "acct_cash",
      paymentAccountName: "Kas",
      affectedObject: "Ayam Geprek",
    });
    expect(result.proposedAction?.expectedEffects).toEqual([
      "Kas bertambah Rp50.000",
      "Pendapatan bertambah Rp50.000",
    ]);
  });

  it("infers sales amount from menu default price when Gemini leaves amount missing", () => {
    const result = validateParserDraft(
      baseInput(),
      baseDraft({
        amount: null,
        missingFields: ["amount"],
        clarificationQuestion: "Berapa nominal penjualannya?",
      }),
      "gemini-3.1-flash-lite",
    );

    expect(result.status).toBe("parsed");
    expect(result.proposedAction).toMatchObject({
      intent: "sales_income",
      amount: 25_000,
      affectedObject: "Ayam Geprek",
    });
    expect(result.proposedAction?.warning).toContain("Nominal diasumsikan 1 x harga menu Ayam Geprek");
  });

  it("uses detected quantity when inferring sales amount from menu price", () => {
    const result = validateParserDraft(
      baseInput({ message: "jual 2 ayam geprek tunai" }),
      baseDraft({
        amount: null,
        missingFields: ["amount"],
        description: "Jual ayam geprek tunai",
      }),
      "gemini-3.1-flash-lite",
    );

    expect(result.status).toBe("parsed");
    expect(result.proposedAction?.amount).toBe(50_000);
    expect(result.proposedAction?.warning).toContain("Nominal dihitung dari 2 x harga menu Ayam Geprek");
  });

  it.each([0, -1, 12.5])("rejects invalid amount %s before confirmation", (amount) => {
    const result = validateParserDraft(baseInput(), baseDraft({ amount }), "gemini-3.1-flash-lite");

    expect(result.status).toBe("needs_clarification");
    expect(result.missingFields).toContain("amount");
    expect(result.validationErrors).toContain("Amount must be a positive integer.");
  });

  it("asks clarification for unsupported intents", () => {
    const result = validateParserDraft(
      baseInput(),
      baseDraft({ detectedIntent: "profit_loss_report" as GeminiParserDraft["detectedIntent"] }),
      "gemini-3.1-flash-lite",
    );

    expect(result.status).toBe("needs_clarification");
    expect(result.missingFields).toContain("intent");
    expect(result.validationErrors).toContain("Intent is not supported.");
    expect(result.question).toBe("Transaksi ini paling cocok dicatat sebagai apa?");
    expect(result.options.map((option) => option.value)).toEqual(expectedIntentOptions);
  });

  it("asks the user to choose from all supported intents when confidence is low", () => {
    const result = validateParserDraft(
      baseInput(),
      baseDraft({ detectedIntent: null, confidence: 0.2, missingFields: ["intent"] }),
      "gemini-3.1-flash-lite",
    );

    expect(result.status).toBe("needs_clarification");
    expect(result.question).toBe("Transaksi ini paling cocok dicatat sebagai apa?");
    expect(result.options.map((option) => option.value)).toEqual(expectedIntentOptions);
  });

  it("asks user to split messages with multiple transaction events", () => {
    const result = validateParserDraft(
      baseInput({ message: "jual ayam 50000 dan bayar listrik 20000" }),
      baseDraft({ multipleEvents: true }),
      "gemini-3.1-flash-lite",
    );

    expect(result.status).toBe("needs_clarification");
    expect(result.missingFields).toContain("single_event");
  });

  it("discloses menu-derived assumptions in the warning", () => {
    const result = validateParserDraft(
      baseInput(),
      baseDraft({ assumptions: ["Nominal dihitung dari 2 x harga menu Ayam Geprek"] }),
      "gemini-3.1-flash-lite",
    );

    expect(result.status).toBe("parsed");
    expect(result.proposedAction?.warning).toContain("Nominal dihitung dari 2 x harga menu Ayam Geprek");
  });

  it("asks clarification when payment account name is ambiguous", () => {
    const result = validateParserDraft(
      baseInput({
        paymentAccounts: [
          { id: "acct_1", name: "Kas", type: "cash", isDefault: false },
          { id: "acct_2", name: "Kas", type: "cash", isDefault: false },
        ],
        defaultPaymentAccountId: null,
        defaultPaymentAccountName: null,
      }),
      baseDraft({ paymentAccountId: null, paymentAccountName: "Kas" }),
      "gemini-3.1-flash-lite",
    );

    expect(result.status).toBe("needs_clarification");
    expect(result.missingFields).toContain("paymentAccountId");
  });

  it("asks which payment account to use when a money-out transaction has no payment account", () => {
    const result = validateParserDraft(
      baseInput({ message: "bayar bensin 50 ribu tanggal 4 Juni 2026", today: "2026-06-05" }),
      baseDraft({
        detectedIntent: "general_expense",
        amount: 50_000,
        date: "2026-06-04",
        paymentAccountId: null,
        paymentAccountName: null,
        description: "Bayar bensin",
        affectedObject: null,
      }),
      "gemini-3.1-flash-lite",
    );

    expect(result.status).toBe("needs_clarification");
    expect(result.missingFields).toContain("paymentAccountId");
    expect(result.question).toBe("Bayarnya pakai akun yang mana?");
    expect(result.options).toContainEqual({ label: "Kas", value: "acct_cash" });
    expect(result.options).toContainEqual({ label: "Bank / QRIS / E-wallet", value: "non_cash" });
  });

  it("asks user to create a payment account when Gemini names an account that does not exist", () => {
    const result = validateParserDraft(
      baseInput({ message: "bayar bensin 50 ribu pake akun kartu kredit tanggal 4 Juni 2026", today: "2026-06-05" }),
      baseDraft({
        detectedIntent: "general_expense",
        amount: 50_000,
        date: "2026-06-04",
        paymentAccountId: null,
        paymentAccountName: "Kartu Kredit",
        description: "Bayar bensin",
        affectedObject: null,
      }),
      "gemini-3.1-flash-lite",
    );

    expect(result.status).toBe("needs_clarification");
    expect(result.missingFields).toContain("paymentAccountDependency");
    expect(result.question).toBe("Akun pembayaran Kartu Kredit belum dibuat. Buat akun itu dulu, lalu catat transaksi lagi.");
  });

  it("uses the clarification answer as the payment account when the user chooses Kas", () => {
    const result = validateParserDraft(
      baseInput({
        message: "bayar bensin 50 ribu tanggal 4 Juni 2026",
        today: "2026-06-05",
        clarification: {
          originalMessage: "bayar bensin 50 ribu tanggal 4 Juni 2026",
          previousPayload: {},
          answer: "acct_cash",
        },
      }),
      baseDraft({
        detectedIntent: "general_expense",
        amount: 50_000,
        date: "2026-06-04",
        paymentAccountId: null,
        paymentAccountName: null,
        description: "Bayar bensin",
        affectedObject: null,
      }),
      "gemini-3.1-flash-lite",
    );

    expect(result.status).toBe("parsed");
    expect(result.proposedAction).toMatchObject({
      paymentAccountId: "acct_cash",
      paymentAccountName: "Kas",
    });
  });

  it("prefers cash account from message keyword even when default account is non-cash", () => {
    const result = validateParserDraft(
      baseInput({
        message: "jual ayam geprek tunai",
        defaultPaymentAccountId: "acct_bank",
        defaultPaymentAccountName: "BCA",
        paymentAccounts: [
          { id: "acct_bank", name: "BCA", type: "non_cash", isDefault: true },
          { id: "acct_cash", name: "Kas", type: "cash", isDefault: false },
        ],
      }),
      baseDraft({
        paymentAccountId: null,
        paymentAccountName: null,
      }),
      "gemini-3.1-flash-lite",
    );

    expect(result.status).toBe("parsed");
    expect(result.proposedAction).toMatchObject({
      paymentAccountId: "acct_cash",
      paymentAccountName: "Kas",
    });
  });

  it("asks user to create menu first when sales menu is not in catalog", () => {
    const result = validateParserDraft(
      baseInput({
        menuItems: [
          {
            id: "menu_nasi_goreng",
            name: "Nasi Goreng",
            aliases: ["nasgor"],
            defaultPrice: 20_000,
            category: "Makanan",
          },
        ],
      }),
      baseDraft({ affectedObject: "Ayam Geprek", description: "Jual ayam geprek tunai" }),
      "gemini-3.1-flash-lite",
    );

    expect(result.status).toBe("needs_clarification");
    expect(result.missingFields).toContain("menu_item_dependency");
    expect(result.question).toContain("belum ada di katalog");
  });

  it("asks user to create liability first when liability target does not exist", () => {
    const result = validateParserDraft(
      baseInput({
        openLiabilities: [],
        message: "bayar utang supplier ayam 100000",
      }),
      baseDraft({
        detectedIntent: "liability_payment",
        amount: 100_000,
        description: "Bayar utang supplier ayam",
        affectedObject: "Supplier ayam",
      }),
      "gemini-3.1-flash-lite",
    );

    expect(result.status).toBe("needs_clarification");
    expect(result.missingFields).toContain("liability_dependency");
    expect(result.question).toContain("Buat data utang dulu");
  });

  it("normalizes a Gemini liability id target to the lender name", () => {
    const result = validateParserDraft(
      baseInput({
        message: "bayar utang Supplier ayam 300 ribu pakai kas tanggal 4 Juni 2026",
        today: "2026-06-05",
      }),
      baseDraft({
        detectedIntent: "liability_payment",
        amount: 300_000,
        date: "2026-06-04",
        description: "Bayar utang Supplier ayam",
        affectedObject: "liab_1",
      }),
      "gemini-3.1-flash-lite",
    );

    expect(result.status).toBe("parsed");
    expect(result.proposedAction).toMatchObject({
      intent: "liability_payment",
      amount: 300_000,
      date: "2026-06-04",
      paymentAccountId: "acct_cash",
      paymentAccountName: "Kas",
      affectedObject: "Supplier Ayam",
    });
    expect(result.proposedAction?.expectedEffects).toEqual([
      "Kas berkurang Rp300.000",
      "Utang Supplier Ayam berkurang Rp300.000",
    ]);
  });

  it("asks user to create receivable first when receivable target does not exist", () => {
    const result = validateParserDraft(
      baseInput({
        openReceivables: [],
        message: "Budi bayar piutang 100000",
      }),
      baseDraft({
        detectedIntent: "receivable_payment",
        amount: 100_000,
        description: "Budi bayar piutang",
        affectedObject: "Budi",
      }),
      "gemini-3.1-flash-lite",
    );

    expect(result.status).toBe("needs_clarification");
    expect(result.missingFields).toContain("receivable_dependency");
    expect(result.question).toContain("Buat data piutang dulu");
  });

  it("normalizes a Gemini receivable id target to the customer name", () => {
    const result = validateParserDraft(
      baseInput({
        message: "Budi bayar piutang 100 ribu pakai kas tanggal 4 Juni 2026",
        today: "2026-06-05",
      }),
      baseDraft({
        detectedIntent: "receivable_payment",
        amount: 100_000,
        date: "2026-06-04",
        description: "Budi bayar piutang",
        affectedObject: "recv_1",
      }),
      "gemini-3.1-flash-lite",
    );

    expect(result.status).toBe("parsed");
    expect(result.proposedAction).toMatchObject({
      intent: "receivable_payment",
      amount: 100_000,
      date: "2026-06-04",
      paymentAccountId: "acct_cash",
      paymentAccountName: "Kas",
      affectedObject: "Budi",
    });
    expect(result.proposedAction?.expectedEffects).toEqual([
      "Kas bertambah Rp100.000",
      "Piutang Budi berkurang Rp100.000",
    ]);
  });

  it("treats multiple receivables for the same customer as one payment target", () => {
    const result = validateParserDraft(
      baseInput({
        message: "Budi bayar piutang 100 ribu tunai tanggal 4 Juni 2026",
        today: "2026-06-05",
        openReceivables: [
          {
            id: "recv_budi_1",
            customerName: "Budi",
            description: "Budi beli tempo",
            outstandingAmount: 150_000,
          },
          {
            id: "recv_budi_2",
            customerName: "Budi",
            description: "Budi ambil katering",
            outstandingAmount: 200_000,
          },
        ],
      }),
      baseDraft({
        detectedIntent: "receivable_payment",
        amount: 100_000,
        date: "2026-06-04",
        description: "Budi bayar piutang",
        affectedObject: "Budi",
      }),
      "gemini-3.1-flash-lite",
    );

    expect(result.status).toBe("parsed");
    expect(result.proposedAction).toMatchObject({
      intent: "receivable_payment",
      amount: 100_000,
      affectedObject: "Budi",
    });
    expect(result.proposedAction?.warning).toContain("Ini tidak menambah pendapatan lagi");
  });

  it("overrides a Gemini expense draft when the purchase is stock-vs-expense ambiguous", () => {
    const result = validateParserDraft(
      baseInput({
        message: "beli bahan masak 50 ribu pakai kas tanggal 4 Juni 2026",
        today: "2026-06-05",
      }),
      baseDraft({
        detectedIntent: "general_expense",
        amount: 50_000,
        date: "2026-06-04",
        description: "Beli bahan masak",
        affectedObject: null,
        confidence: 0.92,
      }),
      "gemini-3.1-flash-lite",
    );

    expect(result.status).toBe("needs_clarification");
    expect(result.question).toBe("Ini mau dicatat sebagai stok/persediaan atau sebagai biaya langsung?");
    expect(result.options).toEqual([
      { label: "Stok / Persediaan", value: "inventory_purchase_value" },
      { label: "Biaya langsung", value: "general_expense" },
    ]);
  });
});

describe("Gemini parser engine", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.PARSER_ENGINE = "gemini";
    process.env.GEMINI_MODEL = "gemini-3.1-flash-lite";
  });

  it("returns a safe intent-guided clarification when Gemini is unavailable", async () => {
    const { GeminiParserUnavailableError } = await import("../src/features/parser/gemini-parser.adapter.js");
    const { createParserEngine } = await import("../src/features/parser/parser-engine.service.js");
    const parser = createParserEngine({
      async parseDraft() {
        throw new GeminiParserUnavailableError();
      },
    });

    const result = await parser.parse(baseInput());

    expect(result.status).toBe("needs_clarification");
    expect(result.missingFields).toContain("parser");
    expect(result.question).toBe("Aku belum bisa membaca transaksi ini dengan aman. Transaksi ini mau dicatat sebagai apa?");
    expect(result.options.map((option) => option.value)).toEqual(expectedIntentOptions);
    expect(result.parserModel).toBe("gemini-3.1-flash-lite");
  });
});
