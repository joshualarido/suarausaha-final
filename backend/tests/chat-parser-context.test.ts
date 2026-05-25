import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("chat parser context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      }),
    );
  });
});
