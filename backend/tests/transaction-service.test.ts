import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/financial-write.js", () => {
  return {
    runFinancialWrite: vi.fn(),
  };
});

import { runFinancialWrite } from "../src/lib/financial-write.js";
import {
  AmbiguousFinancialTargetError,
  createBaseTransaction,
  createBaseTransactionInTransaction,
  FinancialTargetNotFoundError,
  FinancialTargetOverpaymentError,
  InvalidTransactionAmountError,
  MissingAffectedObjectError,
  MissingPaymentAccountForTransactionError,
} from "../src/features/transactions/transaction.service.js";

function buildTx(options?: {
  currentBalance?: string;
  hasAccount?: boolean;
  menuItems?: Array<Record<string, unknown>>;
  liabilities?: Array<Record<string, unknown>>;
  receivables?: Array<Record<string, unknown>>;
}) {
  const state = {
    paymentAccounts:
      options?.hasAccount === false
        ? []
        : [
            {
              id: "acct_cash",
              businessId: "biz_123",
              name: "Kas",
              currentBalance: options?.currentBalance ?? "100000",
            },
          ],
    liabilities: options?.liabilities ?? [],
    receivables: options?.receivables ?? [],
    menuItems: options?.menuItems ?? [],
    transactions: [] as Array<Record<string, unknown>>,
    effects: [] as Array<Record<string, unknown>>,
    inventory: [] as Array<Record<string, unknown>>,
    assets: [] as Array<Record<string, unknown>>,
    corrections: [] as Array<Record<string, unknown>>,
    updatedBalance: null as string | null,
    insertedTransaction: null as Record<string, unknown> | null,
  };

  function tableRows(table: string): Array<Record<string, unknown>> {
    if (table === "payment_accounts") return state.paymentAccounts;
    if (table === "liabilities") return state.liabilities;
    if (table === "receivables") return state.receivables;
    if (table === "menu_items") return state.menuItems;
    if (table === "transactions") return state.transactions;
    if (table === "transaction_effects") return state.effects;
    if (table === "inventory_summaries") return state.inventory;
    if (table === "asset_summaries") return state.assets;
    if (table === "transaction_corrections") return state.corrections;
    return [];
  }

  function matches(row: Record<string, unknown>, wheres: Array<{ column: string; op: string; value: unknown }>) {
    return wheres.every((where) => {
      if (where.op === "in" && Array.isArray(where.value)) return where.value.includes(row[where.column]);
      return row[where.column] === where.value;
    });
  }

  function selectBuilder(table: string, wheres: Array<{ column: string; op: string; value: unknown }> = {} as never): unknown {
    const conditions = Array.isArray(wheres) ? wheres : [];
    return {
      select: () => selectBuilder(table, conditions),
      selectAll: () => selectBuilder(table, conditions),
      where: (column: string, op: string, value: unknown) => selectBuilder(table, [...conditions, { column, op, value }]),
      forUpdate: () => selectBuilder(table, conditions),
      executeTakeFirst: async () => tableRows(table).find((row) => matches(row, conditions)),
      execute: async () => tableRows(table).filter((row) => matches(row, conditions)),
    };
  }

  function insertRow(table: string, value: Record<string, unknown>) {
    const row = { ...value };
    if (table === "transactions") {
      state.transactions.push(row);
      state.insertedTransaction = row;
    } else if (table === "transaction_effects") {
      state.effects.push(row);
    } else if (table === "inventory_summaries") {
      state.inventory.push(row);
    } else if (table === "asset_summaries") {
      state.assets.push(row);
    } else if (table === "liabilities") {
      state.liabilities.push(row);
    } else if (table === "receivables") {
      state.receivables.push(row);
    } else if (table === "transaction_corrections") {
      state.corrections.push(row);
    }
    return row;
  }

  const tx = {
    selectFrom: vi.fn((table: string) => selectBuilder(table)),
    updateTable: vi.fn((table: string) => ({
      set: (values: Record<string, unknown>) => {
        const builder = (conditions: Array<{ column: string; op: string; value: unknown }> = []): unknown => ({
          where: (column: string, op: string, value: unknown) => builder([...conditions, { column, op, value }]),
          executeTakeFirst: async () => {
            const row = tableRows(table).find((candidate) => matches(candidate, conditions));
            if (row) {
              Object.assign(row, values);
              if (table === "payment_accounts" && typeof values.currentBalance === "string") {
                state.updatedBalance = values.currentBalance;
              }
            }
            return row ?? {};
          },
        });
        return builder();
      },
    })),
    insertInto: vi.fn((table: string) => ({
      values: (values: Record<string, unknown>) => ({
        returningAll: () => ({
          executeTakeFirstOrThrow: async () => {
            const row = insertRow(table, values);
            return row;
          },
        }),
        executeTakeFirst: async () => insertRow(table, values),
      }),
    })),
  };

  return { tx, state };
}

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

  it("increases payment account balance for sales income", async () => {
    const { tx, state } = buildTx({
      currentBalance: "500000",
      menuItems: [{ id: "menu_ayam_geprek", businessId: "biz_123", name: "Ayam Geprek", status: "active" }],
    });

    await createBaseTransactionInTransaction(tx as never, {
      businessId: "biz_123",
      createdBy: "user_123",
      type: "sales_income",
      amount: 250_000,
      transactionDate: "2026-05-12",
      description: "Jual ayam geprek",
      affectedObject: "Ayam Geprek",
      paymentAccountId: "acct_cash",
    });

    expect(state.updatedBalance).toBe("750000");
    expect(state.insertedTransaction).not.toBeNull();
    expect(state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetType: "payment_account", direction: "increase", amount: "250000" }),
        expect.objectContaining({ targetType: "business_bucket", effectType: "income", amount: "250000" }),
      ]),
    );
  });

  it("decreases payment account balance for general expense", async () => {
    const { tx, state } = buildTx({ currentBalance: "500000" });

    await createBaseTransactionInTransaction(tx as never, {
      businessId: "biz_123",
      createdBy: "user_123",
      type: "general_expense",
      amount: 100_000,
      transactionDate: "2026-05-12",
      description: "Bayar listrik",
      paymentAccountId: "acct_cash",
    });

    expect(state.updatedBalance).toBe("400000");
    expect(state.insertedTransaction).not.toBeNull();
    expect(state.inventory).toHaveLength(0);
    expect(state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetType: "payment_account", direction: "decrease", amount: "100000" }),
        expect.objectContaining({ targetType: "business_bucket", effectType: "expense", amount: "100000" }),
      ]),
    );
  });

  it("moves cash into inventory for inventory purchase without creating expense", async () => {
    const { tx, state } = buildTx({ currentBalance: "500000" });

    await createBaseTransactionInTransaction(tx as never, {
      businessId: "biz_123",
      createdBy: "user_123",
      type: "inventory_purchase_value",
      amount: 200_000,
      transactionDate: "2026-05-12",
      description: "Beli stok ayam",
      affectedObject: "Stok ayam",
      paymentAccountId: "acct_cash",
    });

    expect(state.updatedBalance).toBe("300000");
    expect(state.inventory).toHaveLength(1);
    expect(state.inventory[0]).toMatchObject({ name: "Stok ayam", estimatedValue: "200000" });
    expect(state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetType: "payment_account", direction: "decrease", amount: "200000" }),
        expect.objectContaining({ targetType: "inventory", effectType: "inventory_value", direction: "increase", amount: "200000" }),
      ]),
    );
    expect(state.effects).not.toEqual(expect.arrayContaining([expect.objectContaining({ effectType: "expense" })]));
  });

  it("records asset value and only decreases cash when a payment account is provided", async () => {
    const { tx, state } = buildTx({ currentBalance: "1500000" });

    await createBaseTransactionInTransaction(tx as never, {
      businessId: "biz_123",
      createdBy: "user_123",
      type: "asset_record_or_purchase",
      amount: 1_000_000,
      transactionDate: "2026-05-12",
      description: "Beli kompor",
      affectedObject: "Kompor",
      paymentAccountId: "acct_cash",
    });

    expect(state.updatedBalance).toBe("500000");
    expect(state.assets[0]).toMatchObject({ name: "Kompor", value: "1000000" });
    expect(state.effects).not.toEqual(expect.arrayContaining([expect.objectContaining({ effectType: "expense" })]));
  });

  it("records existing asset without cash movement when no payment account is provided", async () => {
    const { tx, state } = buildTx({ currentBalance: "1500000" });

    await createBaseTransactionInTransaction(tx as never, {
      businessId: "biz_123",
      createdBy: "user_123",
      type: "asset_record_or_purchase",
      amount: 1_000_000,
      transactionDate: "2026-05-12",
      description: "Catat kompor lama",
      affectedObject: "Kompor lama",
    });

    expect(state.updatedBalance).toBeNull();
    expect(state.assets[0]).toMatchObject({ name: "Kompor lama", value: "1000000" });
    expect(state.effects).toHaveLength(1);
    expect(state.effects[0]).toMatchObject({ targetType: "asset", direction: "increase" });
  });

  it("creates liability without income and increases cash only when borrowed money enters", async () => {
    const { tx, state } = buildTx({ currentBalance: "100000" });

    await createBaseTransactionInTransaction(tx as never, {
      businessId: "biz_123",
      createdBy: "user_123",
      type: "liability_created",
      amount: 400_000,
      transactionDate: "2026-05-12",
      description: "Pinjam uang dari saudara",
      affectedObject: "Saudara",
      paymentAccountId: "acct_cash",
    });

    expect(state.updatedBalance).toBe("500000");
    expect(state.liabilities[0]).toMatchObject({
      lenderName: "Saudara",
      originalAmount: "400000",
      outstandingAmount: "400000",
    });
    expect(state.effects).not.toEqual(expect.arrayContaining([expect.objectContaining({ effectType: "income" })]));
  });

  it("pays a matched liability without creating expense", async () => {
    const { tx, state } = buildTx({
      currentBalance: "500000",
      liabilities: [
        {
          id: "liability_supplier",
          businessId: "biz_123",
          lenderName: "Supplier ayam",
          description: "Utang supplier ayam",
          originalAmount: "300000",
          outstandingAmount: "300000",
          status: "open",
        },
      ],
    });

    await createBaseTransactionInTransaction(tx as never, {
      businessId: "biz_123",
      createdBy: "user_123",
      type: "liability_payment",
      amount: 100_000,
      transactionDate: "2026-05-12",
      description: "Bayar utang supplier",
      affectedObject: "Supplier ayam",
      paymentAccountId: "acct_cash",
    });

    expect(state.updatedBalance).toBe("400000");
    expect(state.liabilities[0]).toMatchObject({ outstandingAmount: "200000", status: "partial" });
    expect(state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetType: "liability", direction: "decrease", amount: "100000" }),
      ]),
    );
    expect(state.effects).not.toEqual(expect.arrayContaining([expect.objectContaining({ effectType: "expense" })]));
  });

  it("pays a liability matched by id without creating expense", async () => {
    const { tx, state } = buildTx({
      currentBalance: "400000",
      liabilities: [
        {
          id: "liability_supplier",
          businessId: "biz_123",
          lenderName: "Supplier ayam",
          description: "Utang supplier ayam",
          originalAmount: "700000",
          outstandingAmount: "700000",
          status: "open",
        },
      ],
    });

    await createBaseTransactionInTransaction(tx as never, {
      businessId: "biz_123",
      createdBy: "user_123",
      type: "liability_payment",
      amount: 300_000,
      transactionDate: "2026-06-04",
      description: "Bayar utang Supplier ayam",
      affectedObject: "liability_supplier",
      paymentAccountId: "acct_cash",
    });

    expect(state.updatedBalance).toBe("100000");
    expect(state.liabilities[0]).toMatchObject({ outstandingAmount: "400000", status: "partial" });
    expect(state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetType: "liability",
          targetId: "liability_supplier",
          direction: "decrease",
          amount: "300000",
        }),
      ]),
    );
    expect(state.effects).not.toEqual(expect.arrayContaining([expect.objectContaining({ effectType: "expense" })]));
  });

  it("creates receivable income without increasing cash", async () => {
    const { tx, state } = buildTx({ currentBalance: "100000" });

    await createBaseTransactionInTransaction(tx as never, {
      businessId: "biz_123",
      createdBy: "user_123",
      type: "receivable_created",
      amount: 150_000,
      transactionDate: "2026-05-12",
      description: "Budi beli belum bayar",
      affectedObject: "Budi",
    });

    expect(state.updatedBalance).toBeNull();
    expect(state.receivables[0]).toMatchObject({
      customerName: "Budi",
      originalAmount: "150000",
      outstandingAmount: "150000",
    });
    expect(state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ effectType: "income" })]));
  });

  it("receives piutang payment without recognizing income again", async () => {
    const { tx, state } = buildTx({
      currentBalance: "100000",
      receivables: [
        {
          id: "receivable_budi",
          businessId: "biz_123",
          customerName: "Budi",
          description: "Budi beli belum bayar",
          originalAmount: "150000",
          outstandingAmount: "150000",
          status: "open",
        },
      ],
    });

    await createBaseTransactionInTransaction(tx as never, {
      businessId: "biz_123",
      createdBy: "user_123",
      type: "receivable_payment",
      amount: 100_000,
      transactionDate: "2026-05-12",
      description: "Budi bayar piutang",
      affectedObject: "Budi",
      paymentAccountId: "acct_cash",
    });

    expect(state.updatedBalance).toBe("200000");
    expect(state.receivables[0]).toMatchObject({ outstandingAmount: "50000", status: "partial" });
    expect(state.effects).not.toEqual(expect.arrayContaining([expect.objectContaining({ effectType: "income" })]));
  });

  it("receives piutang payment matched by id without recognizing income again", async () => {
    const { tx, state } = buildTx({
      currentBalance: "100000",
      receivables: [
        {
          id: "receivable_budi",
          businessId: "biz_123",
          customerName: "Budi",
          description: "Budi beli belum bayar",
          originalAmount: "150000",
          outstandingAmount: "150000",
          status: "open",
        },
      ],
    });

    await createBaseTransactionInTransaction(tx as never, {
      businessId: "biz_123",
      createdBy: "user_123",
      type: "receivable_payment",
      amount: 100_000,
      transactionDate: "2026-06-04",
      description: "Budi bayar piutang",
      affectedObject: "receivable_budi",
      paymentAccountId: "acct_cash",
    });

    expect(state.updatedBalance).toBe("200000");
    expect(state.receivables[0]).toMatchObject({ outstandingAmount: "50000", status: "partial" });
    expect(state.effects).not.toEqual(expect.arrayContaining([expect.objectContaining({ effectType: "income" })]));
  });

  it("allocates piutang payment across multiple rows for the same customer without recognizing income again", async () => {
    const { tx, state } = buildTx({
      currentBalance: "100000",
      receivables: [
        {
          id: "receivable_budi_1",
          businessId: "biz_123",
          customerName: "Budi",
          description: "Budi beli tempo",
          originalAmount: "50000",
          outstandingAmount: "50000",
          status: "open",
        },
        {
          id: "receivable_budi_2",
          businessId: "biz_123",
          customerName: "Budi",
          description: "Budi katering",
          originalAmount: "300000",
          outstandingAmount: "300000",
          status: "open",
        },
      ],
    });

    await createBaseTransactionInTransaction(tx as never, {
      businessId: "biz_123",
      createdBy: "user_123",
      type: "receivable_payment",
      amount: 100_000,
      transactionDate: "2026-06-04",
      description: "Budi bayar piutang",
      affectedObject: "Budi",
      paymentAccountId: "acct_cash",
    });

    expect(state.updatedBalance).toBe("200000");
    expect(state.receivables[0]).toMatchObject({ outstandingAmount: "0", status: "paid" });
    expect(state.receivables[1]).toMatchObject({ outstandingAmount: "250000", status: "partial" });
    expect(state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetId: "receivable_budi_1", amount: "50000" }),
        expect.objectContaining({ targetId: "receivable_budi_2", amount: "50000" }),
      ]),
    );
    expect(state.effects).not.toEqual(expect.arrayContaining([expect.objectContaining({ effectType: "income" })]));
  });

  it("records owner capital as equity, not income", async () => {
    const { tx, state } = buildTx({ currentBalance: "100000" });

    await createBaseTransactionInTransaction(tx as never, {
      businessId: "biz_123",
      createdBy: "user_123",
      type: "owner_capital_contribution",
      amount: 250_000,
      transactionDate: "2026-05-12",
      description: "Tambah modal pemilik",
      paymentAccountId: "acct_cash",
    });

    expect(state.updatedBalance).toBe("350000");
    expect(state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ effectType: "owner_capital" })]));
    expect(state.effects).not.toEqual(expect.arrayContaining([expect.objectContaining({ effectType: "income" })]));
  });

  it("records owner withdrawal as equity reduction, not expense", async () => {
    const { tx, state } = buildTx({ currentBalance: "500000" });

    await createBaseTransactionInTransaction(tx as never, {
      businessId: "biz_123",
      createdBy: "user_123",
      type: "owner_withdrawal",
      amount: 250_000,
      transactionDate: "2026-05-12",
      description: "Ambil uang pribadi",
      paymentAccountId: "acct_cash",
    });

    expect(state.updatedBalance).toBe("250000");
    expect(state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ effectType: "owner_withdrawal" })]));
    expect(state.effects).not.toEqual(expect.arrayContaining([expect.objectContaining({ effectType: "expense" })]));
  });

  it("rejects expense when payment account balance is insufficient", async () => {
    const { tx, state } = buildTx({ currentBalance: "50000" });

    await expect(
      createBaseTransactionInTransaction(tx as never, {
        businessId: "biz_123",
        createdBy: "user_123",
        type: "general_expense",
        amount: 100_000,
        transactionDate: "2026-05-12",
        description: "Bayar listrik",
        paymentAccountId: "acct_cash",
      }),
    ).rejects.toThrow(
      "Saldo Kas tidak cukup. Saldo Kas saat ini Rp50.000, tapi transaksi ini membutuhkan Rp100.000.",
    );

    expect(state.insertedTransaction).toBeNull();
  });

  it("requires payment account for money movement transaction types", async () => {
    const { tx } = buildTx({
      menuItems: [{ id: "menu_ayam_geprek", businessId: "biz_123", name: "Ayam Geprek", status: "active" }],
    });

    await expect(
      createBaseTransactionInTransaction(tx as never, {
        businessId: "biz_123",
        createdBy: "user_123",
        type: "sales_income",
        amount: 100_000,
        transactionDate: "2026-05-12",
        description: "Jual ayam geprek",
        affectedObject: "Ayam Geprek",
      }),
    ).rejects.toBeInstanceOf(MissingPaymentAccountForTransactionError);
  });

  it("rejects sales income when the affected object is not an active catalog item", async () => {
    const { tx, state } = buildTx({
      currentBalance: "500000",
      menuItems: [{ id: "menu_nasi_goreng", businessId: "biz_123", name: "Nasi Goreng", status: "active" }],
    });

    await expect(
      createBaseTransactionInTransaction(tx as never, {
        businessId: "biz_123",
        createdBy: "user_123",
        type: "sales_income",
        amount: 100_000,
        transactionDate: "2026-05-12",
        description: "Jual ayam geprek",
        affectedObject: "Ayam Geprek",
        paymentAccountId: "acct_cash",
      }),
    ).rejects.toBeInstanceOf(FinancialTargetNotFoundError);

    expect(state.insertedTransaction).toBeNull();
  });

  it("requires affected object when paying a liability", async () => {
    const { tx } = buildTx({ currentBalance: "500000" });

    await expect(
      createBaseTransactionInTransaction(tx as never, {
        businessId: "biz_123",
        createdBy: "user_123",
        type: "liability_payment",
        amount: 100_000,
        transactionDate: "2026-05-12",
        description: "Bayar utang",
        paymentAccountId: "acct_cash",
      }),
    ).rejects.toBeInstanceOf(MissingAffectedObjectError);
  });

  it("rejects liability payment when no open liability matches", async () => {
    const { tx } = buildTx({ currentBalance: "500000" });

    await expect(
      createBaseTransactionInTransaction(tx as never, {
        businessId: "biz_123",
        createdBy: "user_123",
        type: "liability_payment",
        amount: 100_000,
        transactionDate: "2026-05-12",
        description: "Bayar utang supplier",
        affectedObject: "Supplier",
        paymentAccountId: "acct_cash",
      }),
    ).rejects.toBeInstanceOf(FinancialTargetNotFoundError);
  });

  it("rejects liability payment when multiple open liabilities match", async () => {
    const { tx } = buildTx({
      currentBalance: "500000",
      liabilities: [
        {
          id: "liability_1",
          businessId: "biz_123",
          lenderName: "Supplier ayam A",
          description: "Utang supplier",
          originalAmount: "300000",
          outstandingAmount: "300000",
          status: "open",
        },
        {
          id: "liability_2",
          businessId: "biz_123",
          lenderName: "Supplier ayam B",
          description: "Utang supplier",
          originalAmount: "300000",
          outstandingAmount: "300000",
          status: "open",
        },
      ],
    });

    await expect(
      createBaseTransactionInTransaction(tx as never, {
        businessId: "biz_123",
        createdBy: "user_123",
        type: "liability_payment",
        amount: 100_000,
        transactionDate: "2026-05-12",
        description: "Bayar utang supplier",
        affectedObject: "Supplier",
        paymentAccountId: "acct_cash",
      }),
    ).rejects.toBeInstanceOf(AmbiguousFinancialTargetError);
  });

  it("rejects liability payment above outstanding amount", async () => {
    const { tx } = buildTx({
      currentBalance: "500000",
      liabilities: [
        {
          id: "liability_supplier",
          businessId: "biz_123",
          lenderName: "Supplier ayam",
          description: "Utang supplier ayam",
          originalAmount: "100000",
          outstandingAmount: "100000",
          status: "open",
        },
      ],
    });

    await expect(
      createBaseTransactionInTransaction(tx as never, {
        businessId: "biz_123",
        createdBy: "user_123",
        type: "liability_payment",
        amount: 200_000,
        transactionDate: "2026-05-12",
        description: "Bayar utang supplier",
        affectedObject: "Supplier ayam",
        paymentAccountId: "acct_cash",
      }),
    ).rejects.toMatchObject({
      message: "Jumlah pembayaran melebihi sisa utang. Ubah jumlah pembayaran agar tidak lebih dari sisa utang.",
    });
  });

  it("rejects receivable payment above outstanding amount", async () => {
    const { tx } = buildTx({
      currentBalance: "500000",
      receivables: [
        {
          id: "receivable_budi",
          businessId: "biz_123",
          customerName: "Budi",
          description: "Budi beli belum bayar",
          originalAmount: "100000",
          outstandingAmount: "100000",
          status: "open",
        },
      ],
    });

    await expect(
      createBaseTransactionInTransaction(tx as never, {
        businessId: "biz_123",
        createdBy: "user_123",
        type: "receivable_payment",
        amount: 200_000,
        transactionDate: "2026-05-12",
        description: "Budi bayar piutang",
        affectedObject: "Budi",
        paymentAccountId: "acct_cash",
      }),
    ).rejects.toMatchObject({
      message: "Jumlah pembayaran melebihi sisa piutang. Ubah jumlah pembayaran agar tidak lebih dari sisa piutang.",
    });
  });
});
