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

vi.mock("../src/features/transactions/transaction.service.js", () => {
  class MissingPaymentAccountForTransactionError extends Error {}
  class InvalidPaymentAccountOwnershipError extends Error {}
  class MissingAffectedObjectError extends Error {}
  class FinancialTargetNotFoundError extends Error {}
  class AmbiguousFinancialTargetError extends Error {}
  class FinancialTargetOverpaymentError extends Error {}

  return {
    reverseLatestTransactionForBusiness: vi.fn(),
    createBaseTransactionInTransaction: vi.fn(),
    NoReversibleTransactionError: class NoReversibleTransactionError extends Error {},
    UnsafeReversalError: class UnsafeReversalError extends Error {},
    InsufficientPaymentAccountBalanceError: class InsufficientPaymentAccountBalanceError extends Error {},
    MissingPaymentAccountForTransactionError,
    InvalidPaymentAccountOwnershipError,
    MissingAffectedObjectError,
    FinancialTargetNotFoundError,
    AmbiguousFinancialTargetError,
    FinancialTargetOverpaymentError,
  };
});

const fakeTx = {
  insertInto: vi.fn(() => fakeInsert),
};

const fakeInsert = {
  values: vi.fn(() => fakeInsert),
  returningAll: vi.fn(() => fakeInsert),
  executeTakeFirstOrThrow: vi.fn(async () => ({
    id: "parsed_123",
  })),
};

import { parseChatMessage } from "../src/features/chat/chat.service.js";
import { listActiveMenuItemsByBusinessId } from "../src/features/menu-items/menu-item.service.js";
import { listPaymentAccountsByBusinessId } from "../src/features/payment-accounts/payment-account.service.js";
import { parserEngine } from "../src/features/parser/parser-engine.service.js";
import { reverseLatestTransactionForBusiness } from "../src/features/transactions/transaction.service.js";

describe("chat parser context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    parserLiabilityRows.length = 0;
    parserLiabilityRows.push({
      id: "liab_1",
      lenderName: "Supplier Ayam",
      description: "Utang stok ayam",
      outstandingAmount: "250000",
      status: "open",
    });
    parserReceivableRows.length = 0;
    parserReceivableRows.push({
      id: "recv_1",
      customerName: "Budi",
      description: "Budi beli tempo",
      outstandingAmount: "150000",
      status: "open",
    });
    vi.mocked(listPaymentAccountsByBusinessId).mockResolvedValue([
      {
        id: "acct_cash",
        businessId: "biz_123",
        name: "Kas",
        type: "cash",
        currentBalance: "0",
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
    vi.mocked(parserEngine.parse).mockResolvedValue({
      status: "needs_clarification",
      proposedAction: null,
      missingFields: ["amount"],
      validationErrors: [],
      question: "Berapa nominal transaksinya?",
      options: [],
      confidence: 0.7,
      parserModel: "test-parser",
      parserVersion: "test-v1",
      structuredPayload: {},
    });
    vi.mocked(reverseLatestTransactionForBusiness).mockResolvedValue({
      originalTransactionId: "txn_original_1",
      reversalTransactionId: "txn_reversal_1",
    } as never);
  });

  it("passes active menu items into parser context", async () => {
    await parseChatMessage({
      businessId: "biz_123",
      userId: "user_123",
      message: "jual 2 ayam geprek tunai",
    });

    expect(listActiveMenuItemsByBusinessId).toHaveBeenCalledWith("biz_123");
    expect(parserEngine.parse).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: "biz_123",
        userId: "user_123",
        message: "jual 2 ayam geprek tunai",
        defaultPaymentAccountId: "acct_cash",
        defaultPaymentAccountName: "Kas",
        paymentAccounts: [
          {
            id: "acct_cash",
            name: "Kas",
            type: "cash",
            isDefault: true,
          },
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
        openLiabilities: [
          {
            id: "liab_1",
            lenderName: "Supplier Ayam",
            description: "Utang stok ayam",
            outstandingAmount: 250_000,
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
      }),
    );
  });

  it("routes undo intent to reversal action instead of parser", async () => {
    await parseChatMessage({
      businessId: "biz_123",
      userId: "user_123",
      message: "undo transaksi terakhir",
    });

    expect(reverseLatestTransactionForBusiness).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: "biz_123",
        userId: "user_123",
      }),
    );
    expect(parserEngine.parse).not.toHaveBeenCalled();
  });
});
