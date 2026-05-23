import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/financial-write.js", () => {
  return {
    runFinancialWrite: vi.fn(),
  };
});

vi.mock("../src/features/transactions/transaction.service.js", () => {
  return {
    createBaseTransactionInTransaction: vi.fn(),
  };
});

import { runFinancialWrite } from "../src/lib/financial-write.js";
import { createBaseTransactionInTransaction } from "../src/features/transactions/transaction.service.js";
import {
  cancelConfirmationRequest,
  confirmConfirmationRequest,
  editConfirmationRequest,
  InvalidConfirmationStateError,
} from "../src/features/confirmations/confirmation.service.js";

function buildTx(overrides = {}) {
  const state = {
    confirmation: {
      id: "confirm_123",
      businessId: "biz_123",
      userId: "user_123",
      parsedCommandId: "parsed_123",
      type: "transaction",
      status: "pending",
      proposedActionJson: {
        intent: "sales_income",
        amount: 500_000,
        date: "2026-05-23",
        paymentAccountId: "acct_cash",
        paymentAccountName: "Kas",
        description: "Jual ayam geprek tunai",
        affectedObject: null,
        expectedEffects: ["Kas bertambah Rp500.000"],
        warning: null,
      },
      summaryText: "Catat pemasukan penjualan Rp500.000",
      warningText: null,
      expectedEffectsJson: ["Kas bertambah Rp500.000"],
      expiresAt: new Date("2026-05-23T10:15:00Z"),
      confirmedAt: null,
      cancelledAt: null,
      resultingTransactionId: null,
      createdAt: new Date("2026-05-23T10:00:00Z"),
      updatedAt: new Date("2026-05-23T10:00:00Z"),
      ...overrides,
    },
    insertedConfirmation: null as unknown,
  };

  function selectBuilder(): unknown {
    return {
      where: () => selectBuilder(),
      forUpdate: () => selectBuilder(),
      executeTakeFirst: async () => state.confirmation,
    };
  }

  const tx = {
    selectFrom: vi.fn(() => ({
      selectAll: () => selectBuilder(),
      select: () => ({
        where: () => ({
          where: () => ({
            where: () => ({
              execute: async () => [state.confirmation],
            }),
          }),
        }),
      }),
    })),
    updateTable: vi.fn(() => ({
      set: (value: Record<string, unknown>) => ({
        where: () => ({
          executeTakeFirst: async () => {
            state.confirmation = { ...state.confirmation, ...value };
            return state.confirmation;
          },
          where: () => ({
            returningAll: () => ({
              executeTakeFirstOrThrow: async () => {
                state.confirmation = { ...state.confirmation, ...value };
                return state.confirmation;
              },
            }),
            executeTakeFirst: async () => {
              state.confirmation = { ...state.confirmation, ...value };
              return state.confirmation;
            },
          }),
          returningAll: () => ({
            executeTakeFirstOrThrow: async () => {
              state.confirmation = { ...state.confirmation, ...value };
              return state.confirmation;
            },
          }),
        }),
      }),
    })),
    insertInto: vi.fn(() => ({
      values: (value: unknown) => ({
        returningAll: () => ({
          executeTakeFirstOrThrow: async () => {
            state.insertedConfirmation = value;
            return value;
          },
        }),
      }),
    })),
  };

  return { tx, state };
}

describe("confirmation service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.setSystemTime(new Date("2026-05-23T10:05:00Z"));
  });

  it("cancels pending confirmations without creating a transaction", async () => {
    const { tx } = buildTx();
    vi.mocked(runFinancialWrite).mockImplementation(async (callback) => callback(tx as never));

    const result = await cancelConfirmationRequest({
      businessId: "biz_123",
      userId: "user_123",
      confirmationRequestId: "confirm_123",
    });

    expect(result.status).toBe("cancelled");
    expect(createBaseTransactionInTransaction).not.toHaveBeenCalled();
  });

  it("rejects expired confirmations before writing", async () => {
    const { tx } = buildTx({
      expiresAt: new Date("2026-05-23T09:59:00Z"),
    });
    vi.mocked(runFinancialWrite).mockImplementation(async (callback) => callback(tx as never));

    await expect(
      confirmConfirmationRequest({
        businessId: "biz_123",
        userId: "user_123",
        confirmationRequestId: "confirm_123",
      }),
    ).rejects.toBeInstanceOf(InvalidConfirmationStateError);

    expect(createBaseTransactionInTransaction).not.toHaveBeenCalled();
  });

  it("returns the existing transaction for duplicate confirms", async () => {
    const { tx } = buildTx({
      status: "confirmed",
      resultingTransactionId: "txn_123",
      confirmedAt: new Date("2026-05-23T10:01:00Z"),
    });
    vi.mocked(runFinancialWrite).mockImplementation(async (callback) => callback(tx as never));

    const result = await confirmConfirmationRequest({
      businessId: "biz_123",
      userId: "user_123",
      confirmationRequestId: "confirm_123",
    });

    expect(result.transactionId).toBe("txn_123");
    expect(createBaseTransactionInTransaction).not.toHaveBeenCalled();
  });

  it("edits by cancelling the old confirmation and creating a new pending one", async () => {
    const { tx, state } = buildTx();
    vi.mocked(runFinancialWrite).mockImplementation(async (callback) => callback(tx as never));

    await editConfirmationRequest({
      businessId: "biz_123",
      userId: "user_123",
      confirmationRequestId: "confirm_123",
      patch: {
        amount: 450_000,
        description: "Jual ayam geprek",
      },
    });

    expect(state.confirmation.status).toBe("cancelled");
    expect(state.insertedConfirmation).toMatchObject({
      businessId: "biz_123",
      userId: "user_123",
      status: "pending",
    });
  });
});
