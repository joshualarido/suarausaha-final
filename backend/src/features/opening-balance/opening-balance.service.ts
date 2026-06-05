import { randomUUID } from "node:crypto";
import { runFinancialWrite, type FinancialWriteTx } from "../../lib/financial-write.js";
import { db, type OpeningBalanceRow } from "../../lib/database.js";
import { seedDefaultPaymentAccounts, seedOpeningPaymentAccounts } from "../payment-accounts/payment-account.service.js";

export interface OpeningBalanceAggregateInput {
  cashBalance: number;
  nonCashBalance?: number;
  inventoryValue: number;
  assetValue: number;
  debtValue: number;
  receivableValue: number;
}

export interface OpeningPaymentAccountInput {
  name: string;
  type: "cash" | "non_cash";
  openingBalance: number;
}

export interface OpeningInventoryItemInput {
  name?: string;
  value: number;
}

export interface OpeningAssetItemInput {
  name: string;
  value: number;
}

export interface OpeningLiabilityItemInput {
  lenderName: string;
  amount: number;
}

export interface OpeningReceivableItemInput {
  customerName: string;
  amount: number;
}

export interface OpeningBalanceItemizedInput {
  paymentAccounts: OpeningPaymentAccountInput[];
  inventoryItems: OpeningInventoryItemInput[];
  assetItems: OpeningAssetItemInput[];
  liabilityItems: OpeningLiabilityItemInput[];
  receivableItems: OpeningReceivableItemInput[];
}

export type OpeningBalanceInput = OpeningBalanceAggregateInput | OpeningBalanceItemizedInput;

export interface NormalizedOpeningBalanceInput extends Required<OpeningBalanceAggregateInput> {
  paymentAccounts: OpeningPaymentAccountInput[];
  inventoryItems: OpeningInventoryItemInput[];
  assetItems: OpeningAssetItemInput[];
  liabilityItems: OpeningLiabilityItemInput[];
  receivableItems: OpeningReceivableItemInput[];
  isItemized: boolean;
}

export interface OpeningBalancePreview {
  cashBalance: number;
  nonCashBalance: number;
  inventoryValue: number;
  assetValue: number;
  debtValue: number;
  receivableValue: number;
  openingAssets: number;
  openingLiabilities: number;
  openingEquity: number;
}

export class OpeningBalanceAlreadyConfirmedError extends Error {
  constructor() {
    super("Opening balance already confirmed for this business.");
  }
}

function toBigInt(value: number): bigint {
  return BigInt(value);
}

function fromBigIntString(value: string): number {
  return Number(value);
}

function sumBy<T>(items: T[], getValue: (item: T) => number): number {
  return items.reduce((total, item) => total + getValue(item), 0);
}

function trimItemizedInput(input: OpeningBalanceItemizedInput): OpeningBalanceItemizedInput {
  return {
    paymentAccounts: input.paymentAccounts.map((account) => ({
      name: account.name.trim(),
      type: account.type,
      openingBalance: account.openingBalance,
    })),
    inventoryItems: input.inventoryItems.map((item) => ({
      name: item.name?.trim() || "Saldo awal persediaan",
      value: item.value,
    })),
    assetItems: input.assetItems.map((item) => ({ name: item.name.trim(), value: item.value })),
    liabilityItems: input.liabilityItems.map((item) => ({ lenderName: item.lenderName.trim(), amount: item.amount })),
    receivableItems: input.receivableItems.map((item) => ({
      customerName: item.customerName.trim(),
      amount: item.amount,
    })),
  };
}

export function normalizeOpeningBalanceInput(input: OpeningBalanceInput): NormalizedOpeningBalanceInput {
  if ("paymentAccounts" in input) {
    const trimmed = trimItemizedInput(input);
    const cashBalance = sumBy(
      trimmed.paymentAccounts.filter((account) => account.type === "cash"),
      (account) => account.openingBalance,
    );
    const nonCashBalance = sumBy(
      trimmed.paymentAccounts.filter((account) => account.type === "non_cash"),
      (account) => account.openingBalance,
    );

    return {
      cashBalance,
      nonCashBalance,
      inventoryValue: sumBy(trimmed.inventoryItems, (item) => item.value),
      assetValue: sumBy(trimmed.assetItems, (item) => item.value),
      debtValue: sumBy(trimmed.liabilityItems, (item) => item.amount),
      receivableValue: sumBy(trimmed.receivableItems, (item) => item.amount),
      ...trimmed,
      isItemized: true,
    };
  }

  return {
    cashBalance: input.cashBalance,
    nonCashBalance: input.nonCashBalance ?? 0,
    inventoryValue: input.inventoryValue,
    assetValue: input.assetValue,
    debtValue: input.debtValue,
    receivableValue: input.receivableValue,
    paymentAccounts: [],
    inventoryItems: [],
    assetItems: [],
    liabilityItems: [],
    receivableItems: [],
    isItemized: false,
  };
}

export function previewOpeningBalance(input: OpeningBalanceInput): OpeningBalancePreview {
  const normalized = normalizeOpeningBalanceInput(input);
  const openingAssets =
    normalized.cashBalance +
    normalized.nonCashBalance +
    normalized.inventoryValue +
    normalized.assetValue +
    normalized.receivableValue;
  const openingLiabilities = normalized.debtValue;
  const openingEquity = openingAssets - openingLiabilities;

  return {
    cashBalance: normalized.cashBalance,
    nonCashBalance: normalized.nonCashBalance,
    inventoryValue: normalized.inventoryValue,
    assetValue: normalized.assetValue,
    debtValue: normalized.debtValue,
    receivableValue: normalized.receivableValue,
    openingAssets,
    openingLiabilities,
    openingEquity,
  };
}

export async function getConfirmedOpeningBalanceByBusinessId(businessId: string): Promise<OpeningBalanceRow | null> {

  const record = await db
    .selectFrom("opening_balances")
    .selectAll()
    .where("businessId", "=", businessId)
    .where("status", "=", "confirmed")
    .executeTakeFirst();

  return record ?? null;
}

export async function confirmOpeningBalance(
  businessId: string,
  input: OpeningBalanceInput,
): Promise<OpeningBalanceRow> {
  const normalized = normalizeOpeningBalanceInput(input);
  const preview = previewOpeningBalance(normalized);

  return runFinancialWrite(async (tx) => {
    const existing = await tx
      .selectFrom("opening_balances")
      .selectAll()
      .where("businessId", "=", businessId)
      .executeTakeFirst();

    if (existing?.status === "confirmed") {
      throw new OpeningBalanceAlreadyConfirmedError();
    }

    if (normalized.isItemized) {
      await seedOpeningPaymentAccounts(tx, {
        businessId,
        paymentAccounts: normalized.paymentAccounts.map((account) => ({
          name: account.name,
          type: account.type,
          openingBalance: toBigInt(account.openingBalance),
        })),
      });
    } else {
      await seedDefaultPaymentAccounts(tx, {
        businessId,
        cashBalance: toBigInt(normalized.cashBalance),
      });
    }

    const now = new Date();
    const recordDate = now.toISOString().slice(0, 10);

    if (existing) {
      const updated = await tx
        .updateTable("opening_balances")
        .set({
          cashBalance: toBigInt(normalized.cashBalance).toString(),
          nonCashBalance: toBigInt(normalized.nonCashBalance).toString(),
          inventoryValue: toBigInt(normalized.inventoryValue).toString(),
          assetValue: toBigInt(normalized.assetValue).toString(),
          debtValue: toBigInt(normalized.debtValue).toString(),
          receivableValue: toBigInt(normalized.receivableValue).toString(),
          openingAssets: toBigInt(preview.openingAssets).toString(),
          openingLiabilities: toBigInt(preview.openingLiabilities).toString(),
          openingEquity: toBigInt(preview.openingEquity).toString(),
          status: "confirmed",
          confirmedAt: now,
          updatedAt: now,
        })
        .where("id", "=", existing.id)
        .returningAll()
        .executeTakeFirstOrThrow();

      if (normalized.isItemized) {
        await createOpeningDetailRows(tx, {
          businessId,
          openingBalanceId: updated.id,
          recordDate,
          now,
          input: normalized,
        });
      }

      return updated;
    }

    const openingBalanceId = randomUUID();
    const created = await tx
      .insertInto("opening_balances")
      .values({
        id: openingBalanceId,
        businessId,
        cashBalance: toBigInt(normalized.cashBalance).toString(),
        nonCashBalance: toBigInt(normalized.nonCashBalance).toString(),
        inventoryValue: toBigInt(normalized.inventoryValue).toString(),
        assetValue: toBigInt(normalized.assetValue).toString(),
        debtValue: toBigInt(normalized.debtValue).toString(),
        receivableValue: toBigInt(normalized.receivableValue).toString(),
        openingAssets: toBigInt(preview.openingAssets).toString(),
        openingLiabilities: toBigInt(preview.openingLiabilities).toString(),
        openingEquity: toBigInt(preview.openingEquity).toString(),
        status: "confirmed",
        confirmedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    if (normalized.isItemized) {
      await createOpeningDetailRows(tx, {
        businessId,
        openingBalanceId: created.id,
        recordDate,
        now,
        input: normalized,
      });
    }

    return created;
  });
}

async function createOpeningDetailRows(
  tx: FinancialWriteTx,
  input: {
    businessId: string;
    openingBalanceId: string;
    recordDate: string;
    now: Date;
    input: NormalizedOpeningBalanceInput;
  },
): Promise<void> {
  await Promise.all([
    tx.deleteFrom("inventory_summaries").where("sourceOpeningBalanceId", "=", input.openingBalanceId).execute(),
    tx.deleteFrom("asset_summaries").where("sourceOpeningBalanceId", "=", input.openingBalanceId).execute(),
    tx.deleteFrom("liabilities").where("sourceOpeningBalanceId", "=", input.openingBalanceId).execute(),
    tx.deleteFrom("receivables").where("sourceOpeningBalanceId", "=", input.openingBalanceId).execute(),
  ]);

  for (const item of input.input.inventoryItems.filter((item) => item.value > 0)) {
    await tx
      .insertInto("inventory_summaries")
      .values({
        id: randomUUID(),
        businessId: input.businessId,
        name: item.name ?? "Saldo awal persediaan",
        estimatedValue: toBigInt(item.value).toString(),
        sourceOpeningBalanceId: input.openingBalanceId,
        sourceTransactionId: null,
        lastUpdatedAt: input.now,
        status: "active",
        createdAt: input.now,
        updatedAt: input.now,
      })
      .executeTakeFirst();
  }

  for (const item of input.input.assetItems.filter((item) => item.value > 0)) {
    await tx
      .insertInto("asset_summaries")
      .values({
        id: randomUUID(),
        businessId: input.businessId,
        name: item.name,
        value: toBigInt(item.value).toString(),
        recordedDate: input.recordDate,
        sourceOpeningBalanceId: input.openingBalanceId,
        sourceTransactionId: null,
        status: "active",
        createdAt: input.now,
        updatedAt: input.now,
      })
      .executeTakeFirst();
  }

  for (const item of input.input.liabilityItems.filter((item) => item.amount > 0)) {
    await tx
      .insertInto("liabilities")
      .values({
        id: randomUUID(),
        businessId: input.businessId,
        lenderName: item.lenderName,
        description: "Saldo awal utang",
        originalAmount: toBigInt(item.amount).toString(),
        outstandingAmount: toBigInt(item.amount).toString(),
        createdDate: input.recordDate,
        status: "open",
        sourceOpeningBalanceId: input.openingBalanceId,
        sourceTransactionId: null,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .executeTakeFirst();
  }

  for (const item of input.input.receivableItems.filter((item) => item.amount > 0)) {
    await tx
      .insertInto("receivables")
      .values({
        id: randomUUID(),
        businessId: input.businessId,
        customerName: item.customerName,
        description: "Saldo awal piutang",
        originalAmount: toBigInt(item.amount).toString(),
        outstandingAmount: toBigInt(item.amount).toString(),
        createdDate: input.recordDate,
        status: "open",
        sourceOpeningBalanceId: input.openingBalanceId,
        sourceTransactionId: null,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .executeTakeFirst();
  }
}

export function toOpeningBalanceResponse(record: OpeningBalanceRow): {
  id: string;
  cashBalance: number;
  nonCashBalance: number;
  inventoryValue: number;
  assetValue: number;
  debtValue: number;
  receivableValue: number;
  openingEquity: number;
  confirmedAt: Date | null;
} {
  return {
    id: record.id,
    cashBalance: fromBigIntString(record.cashBalance),
    nonCashBalance: fromBigIntString(record.nonCashBalance),
    inventoryValue: fromBigIntString(record.inventoryValue),
    assetValue: fromBigIntString(record.assetValue),
    debtValue: fromBigIntString(record.debtValue),
    receivableValue: fromBigIntString(record.receivableValue),
    openingEquity: fromBigIntString(record.openingEquity),
    confirmedAt: record.confirmedAt,
  };
}
