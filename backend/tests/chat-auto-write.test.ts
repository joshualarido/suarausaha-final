import { beforeEach, describe, expect, it, vi } from "vitest";

const parserLiabilityRows: Array<Record<string, unknown>> = [];
const parserReceivableRows: Array<Record<string, unknown>> = [];

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
        select: () => selectBuilder(table),
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

import { parseChatMessage } from "../src/features/chat/chat.service.js";
import { createConfirmationRequest } from "../src/features/confirmations/confirmation.service.js";
import { listActiveMenuItemsByBusinessId } from "../src/features/menu-items/menu-item.service.js";
import { listPaymentAccountsByBusinessId } from "../src/features/payment-accounts/payment-account.service.js";
import { parserEngine } from "../src/features/parser/parser-engine.service.js";
import { createBaseTransactionInTransaction } from "../src/features/transactions/transaction.service.js";

describe("chat auto-write mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    parserLiabilityRows.length = 0;
    parserReceivableRows.length = 0;

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
  });

  it("auto-saves approved intents immediately", async () => {
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
    vi.mocked(createBaseTransactionInTransaction).mockResolvedValue({
      id: "txn_123",
    } as never);

    const result = await parseChatMessage({
      businessId: "biz_123",
      userId: "user_123",
      message: "jual ayam geprek 120 ribu tunai",
    });

    expect(result).toMatchObject({
      status: "saved_fast",
      transactionId: "txn_123",
      captureMode: "auto_fast",
    });
    expect(createBaseTransactionInTransaction).toHaveBeenCalledWith(
      fakeTx as never,
      expect.objectContaining({
        type: "sales_income",
        confirmationRequestId: null,
        parsedCommandId: "parsed_123",
      }),
    );
    expect(createConfirmationRequest).not.toHaveBeenCalled();
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
      message: "beli stok ayam 90 ribu",
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
});
