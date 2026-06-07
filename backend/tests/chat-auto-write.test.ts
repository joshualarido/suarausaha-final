import { beforeEach, describe, expect, it, vi } from "vitest";

const parserLiabilityRows: Array<Record<string, unknown>> = [];
const parserReceivableRows: Array<Record<string, unknown>> = [];
let parserCommandRow: Record<string, unknown> | null = null;

vi.mock("../src/lib/database.js", () => {
  function selectBuilder(table: string) {
    const rows = table === "liabilities" ? parserLiabilityRows : parserReceivableRows;
    return {
      where: () => selectBuilder(table),
      execute: async () => rows,
    };
  }

  return {
    db: {
      selectFrom: vi.fn((table: string) => ({
        selectAll: () => ({
          where: () => ({
            where: () => ({
              where: () => ({
                executeTakeFirst: async () => (table === "parsed_commands" ? parserCommandRow : null),
              }),
            }),
          }),
        }),
        select: () => (table === "parsed_commands"
          ? {
              where: () => ({
                where: () => ({
                  where: () => ({
                    executeTakeFirst: async () => parserCommandRow,
                  }),
                }),
              }),
            }
          : selectBuilder(table)),
      })),
    },
  };
});

const fakeTx = {
  insertInto: vi.fn(() => ({
    values: vi.fn(() => ({
      returningAll: vi.fn(() => ({
        executeTakeFirstOrThrow: vi.fn(async () => ({
          id: "parsed_123",
        })),
      })),
    })),
  })),
  updateTable: vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        executeTakeFirst: vi.fn(async () => ({})),
      })),
    })),
  })),
};

vi.mock("../src/lib/financial-write.js", () => {
  return {
    runFinancialWrite: vi.fn(async (callback) => callback(fakeTx)),
  };
});

vi.mock("../src/features/chat/chat-message.service.js", () => {
  return {
    appendChatMessage: vi.fn(),
  };
});

vi.mock("../src/features/payment-accounts/payment-account.service.js", () => {
  return {
    listPaymentAccountsByBusinessId: vi.fn(),
  };
});

vi.mock("../src/features/menu-items/menu-item.service.js", () => {
  return {
    listActiveMenuItemsByBusinessId: vi.fn(),
  };
});

vi.mock("../src/features/parser/parser-engine.service.js", () => {
  return {
    parserEngine: {
      parse: vi.fn(),
    },
  };
});

vi.mock("../src/features/confirmations/confirmation.service.js", () => {
  return {
    cancelPendingConfirmationsInTransaction: vi.fn(),
    createConfirmationRequest: vi.fn(),
    listPendingIntentConfirmations: vi.fn(),
    toConfirmationResponse: vi.fn((value) => value),
  };
});

vi.mock("../src/features/transactions/transaction.service.js", () => {
  class MissingPaymentAccountForTransactionError extends Error {}
  class InvalidPaymentAccountOwnershipError extends Error {}
  class MissingAffectedObjectError extends Error {}
  class FinancialTargetNotFoundError extends Error {}
  class AmbiguousFinancialTargetError extends Error {}
  class FinancialTargetOverpaymentError extends Error {}
  class InsufficientPaymentAccountBalanceError extends Error {}

  return {
    createBaseTransactionInTransaction: vi.fn(),
    reverseLatestTransactionForBusiness: vi.fn(),
    NoReversibleTransactionError: class NoReversibleTransactionError extends Error {},
    UnsafeReversalError: class UnsafeReversalError extends Error {},
    MissingPaymentAccountForTransactionError,
    InvalidPaymentAccountOwnershipError,
    MissingAffectedObjectError,
    FinancialTargetNotFoundError,
    AmbiguousFinancialTargetError,
    FinancialTargetOverpaymentError,
    InsufficientPaymentAccountBalanceError,
  };
});

import { clarifyChatMessage, parseChatMessage } from "../src/features/chat/chat.service.js";
import { createConfirmationRequest, listPendingIntentConfirmations } from "../src/features/confirmations/confirmation.service.js";
import { listActiveMenuItemsByBusinessId } from "../src/features/menu-items/menu-item.service.js";
import { listPaymentAccountsByBusinessId } from "../src/features/payment-accounts/payment-account.service.js";
import { parserEngine } from "../src/features/parser/parser-engine.service.js";
import { createBaseTransactionInTransaction } from "../src/features/transactions/transaction.service.js";

describe("chat auto-write mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    parserLiabilityRows.length = 0;
    parserReceivableRows.length = 0;
    parserCommandRow = null;

    vi.mocked(listPaymentAccountsByBusinessId).mockResolvedValue([
      {
        id: "acct_cash",
        businessId: "biz_123",
        name: "Kas",
        type: "cash",
        currentBalance: "250000",
        isDefault: true,
        status: "active",
      },
    ] as never);

    vi.mocked(listActiveMenuItemsByBusinessId).mockResolvedValue([
      {
        id: "menu_ayam_geprek",
        businessId: "biz_123",
        name: "Ayam Geprek",
        aliases: ["geprek"],
        defaultPrice: "15000",
        category: "Makanan",
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as never);
    vi.mocked(listPendingIntentConfirmations).mockResolvedValue([] as never);
  });

  it("routes sales intents to confirmation instead of auto-saving", async () => {
    vi.mocked(parserEngine.parse).mockResolvedValue({
      status: "parsed",
      proposedAction: {
        intent: "sales_income",
        amount: 120000,
        date: "2026-05-25",
        paymentAccountId: "acct_cash",
        paymentAccountName: "Kas",
        description: "Jual ayam geprek",
        affectedObject: "Ayam Geprek",
        expectedEffects: ["Kas bertambah Rp120.000", "Pendapatan bertambah Rp120.000"],
        warning: null,
      },
      missingFields: [],
      validationErrors: [],
      confidence: 0.95,
      parserModel: "test",
      parserVersion: "v1",
      structuredPayload: {},
    } as never);
    vi.mocked(createConfirmationRequest).mockResolvedValue({
      id: "confirm_123",
      proposedActionJson: {},
    } as never);

    const result = await parseChatMessage({
      businessId: "biz_123",
      userId: "user_123",
      message: "jual ayam geprek 120 ribu tunai",
    });

    expect(result).toMatchObject({
      status: "requires_confirmation",
      confirmationRequestId: "confirm_123",
    });
    expect(createBaseTransactionInTransaction).not.toHaveBeenCalled();
    expect(createConfirmationRequest).toHaveBeenCalledWith(
      fakeTx as never,
      expect.objectContaining({
        proposedAction: expect.objectContaining({
          intent: "sales_income",
        }),
      }),
    );
  });

  it("keeps confirmation flow for non auto-write intents", async () => {
    vi.mocked(parserEngine.parse).mockResolvedValue({
      status: "parsed",
      proposedAction: {
        intent: "inventory_purchase_value",
        amount: 90000,
        date: "2026-05-25",
        paymentAccountId: "acct_cash",
        paymentAccountName: "Kas",
        description: "Beli stok ayam",
        affectedObject: "Stok ayam",
        expectedEffects: ["Kas berkurang Rp90.000", "Nilai persediaan bertambah Rp90.000"],
        warning: null,
      },
      missingFields: [],
      validationErrors: [],
      confidence: 0.96,
      parserModel: "test",
      parserVersion: "v1",
      structuredPayload: {},
    } as never);
    vi.mocked(createConfirmationRequest).mockResolvedValue({
      id: "confirm_123",
      proposedActionJson: {},
    } as never);

    const result = await parseChatMessage({
      businessId: "biz_123",
      userId: "user_123",
      message: "catat aset etalase 90 ribu",
    });

    expect(result).toMatchObject({
      status: "requires_confirmation",
      confirmationRequestId: "confirm_123",
    });
    expect(createConfirmationRequest).toHaveBeenCalled();
    expect(createBaseTransactionInTransaction).not.toHaveBeenCalled();
  });

  it("does not auto-save low confidence messages", async () => {
    vi.mocked(parserEngine.parse).mockResolvedValue({
      status: "parsed",
      proposedAction: {
        intent: "general_expense",
        amount: 50000,
        date: "2026-05-25",
        paymentAccountId: "acct_cash",
        paymentAccountName: "Kas",
        description: "Bayar sesuatu",
        affectedObject: null,
        expectedEffects: ["Kas berkurang Rp50.000", "Biaya bertambah Rp50.000"],
        warning: null,
      },
      missingFields: [],
      validationErrors: [],
      confidence: 0.6,
      parserModel: "test",
      parserVersion: "v1",
      structuredPayload: {},
    } as never);

    const result = await parseChatMessage({
      businessId: "biz_123",
      userId: "user_123",
      message: "bayar 50 ribu",
    });

    expect(result).toMatchObject({
      status: "requires_clarification",
      missingFields: ["confidence"],
    });
    expect(createBaseTransactionInTransaction).not.toHaveBeenCalled();
    expect(createConfirmationRequest).not.toHaveBeenCalled();
  });

  it("updates an active POS sales confirmation from follow-up input", async () => {
    vi.mocked(listPendingIntentConfirmations).mockResolvedValue([
      {
        id: "confirm_old",
        businessId: "biz_123",
        userId: "user_123",
        parsedCommandId: "parsed_old",
        type: "transaction",
        status: "pending",
        proposedActionJson: {
          intent: "sales_income",
          amount: 45_000,
          date: "2026-05-25",
          paymentAccountId: "acct_cash",
          paymentAccountName: "Kas",
          description: "Jual 3 Ayam Geprek",
          affectedObject: "Ayam Geprek",
          expectedEffects: ["Kas bertambah Rp45.000", "Pendapatan bertambah Rp45.000"],
          warning: null,
          salesOrder: {
            status: "draft",
            totalAmount: 45_000,
            lines: [
              {
                productId: "menu_ayam_geprek",
                productName: "Ayam Geprek",
                spokenLabel: "ayam geprek",
                quantity: 3,
                unitPrice: 15_000,
                subtotal: 45_000,
                matchStatus: "matched",
              },
            ],
          },
        },
      },
    ] as never);
    vi.mocked(createConfirmationRequest).mockResolvedValue({
      id: "confirm_new",
      proposedActionJson: {},
    } as never);

    const result = await parseChatMessage({
      businessId: "biz_123",
      userId: "user_123",
      message: "eh ayamnya 2 aja",
    });

    expect(result).toMatchObject({
      status: "requires_confirmation",
      confirmationRequestId: "confirm_new",
      proposedAction: {
        intent: "sales_income",
        amount: 30_000,
        salesOrder: {
          lines: [
            expect.objectContaining({
              productName: "Ayam Geprek",
              quantity: 2,
              subtotal: 30_000,
            }),
          ],
        },
      },
    });
    expect(parserEngine.parse).not.toHaveBeenCalled();
    expect(createConfirmationRequest).toHaveBeenCalledWith(
      fakeTx as never,
      expect.objectContaining({
        proposedAction: expect.objectContaining({
          amount: 30_000,
        }),
      }),
    );
  });

  it("clarifies ambiguous bahan purchases before parser output can auto-save", async () => {
    const result = await parseChatMessage({
      businessId: "biz_123",
      userId: "user_123",
      message: "beli bahan masak 50 ribu pakai kas tanggal 4 Juni 2026",
    });

    expect(result).toMatchObject({
      status: "requires_clarification",
      question: "Ini mau dicatat sebagai stok/persediaan atau sebagai biaya langsung?",
      options: [
        { label: "Stok / Persediaan", value: "inventory_purchase_value" },
        { label: "Biaya langsung", value: "general_expense" },
      ],
    });
    expect(parserEngine.parse).not.toHaveBeenCalled();
    expect(createBaseTransactionInTransaction).not.toHaveBeenCalled();
    expect(createConfirmationRequest).not.toHaveBeenCalled();
  });

  it("creates a confirmation card after resolving an ambiguous purchase as direct expense", async () => {
    parserCommandRow = {
      id: "parsed_123",
      businessId: "biz_123",
      userId: "user_123",
      rawInputText: "beli bahan masak 50 ribu pakai kas tanggal 4 Juni 2026",
      detectedIntent: "ambiguous_purchase",
      structuredPayload: JSON.stringify({
        rawInputText: "beli bahan masak 50 ribu pakai kas tanggal 4 Juni 2026",
        amount: 50_000,
        date: "2026-06-04",
        detectedIntent: "ambiguous_purchase",
        ambiguityType: "inventory_or_direct_expense",
      }),
    };
    vi.mocked(createConfirmationRequest).mockResolvedValue({
      id: "confirm_123",
      proposedActionJson: {},
    } as never);

    const result = await clarifyChatMessage({
      businessId: "biz_123",
      userId: "user_123",
      clarificationId: "parsed_123",
      answer: "general_expense",
    });

    expect(result).toMatchObject({
      status: "requires_confirmation",
      confirmationRequestId: "confirm_123",
      proposedAction: {
        intent: "general_expense",
        amount: 50_000,
        date: "2026-06-04",
        paymentAccountId: "acct_cash",
        paymentAccountName: "Kas",
      },
    });
    expect(parserEngine.parse).not.toHaveBeenCalled();
    expect(createBaseTransactionInTransaction).not.toHaveBeenCalled();
    expect(createConfirmationRequest).toHaveBeenCalledWith(
      fakeTx as never,
      expect.objectContaining({
        proposedAction: expect.objectContaining({
          intent: "general_expense",
          expectedEffects: ["Kas berkurang Rp50.000", "Biaya bertambah Rp50.000"],
        }),
      }),
    );
  });
});
