import { randomUUID } from "node:crypto";
import { runFinancialWrite } from "../../lib/financial-write.js";
import { db, type OpeningBalanceRow } from "../../lib/database.js";
import { seedDefaultPaymentAccounts } from "../payment-accounts/payment-account.service.js";

export interface OpeningBalanceInput {
  cashBalance: number;
  nonCashBalance: number;
  inventoryValue: number;
  assetValue: number;
  debtValue: number;
  receivableValue: number;
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

export function previewOpeningBalance(input: OpeningBalanceInput): OpeningBalancePreview {
  const openingAssets =
    input.cashBalance +
    input.nonCashBalance +
    input.inventoryValue +
    input.assetValue +
    input.receivableValue;
  const openingLiabilities = input.debtValue;
  const openingEquity = openingAssets - openingLiabilities;

  return {
    ...input,
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
  const preview = previewOpeningBalance(input);

  return runFinancialWrite(async (tx) => {
    const existing = await tx
      .selectFrom("opening_balances")
      .selectAll()
      .where("businessId", "=", businessId)
      .executeTakeFirst();

    if (existing?.status === "confirmed") {
      throw new OpeningBalanceAlreadyConfirmedError();
    }

    await seedDefaultPaymentAccounts(tx, {
      businessId,
      cashBalance: toBigInt(input.cashBalance),
    });

    const now = new Date();

    if (existing) {
      const updated = await tx
        .updateTable("opening_balances")
        .set({
          cashBalance: toBigInt(input.cashBalance).toString(),
          nonCashBalance: toBigInt(input.nonCashBalance).toString(),
          inventoryValue: toBigInt(input.inventoryValue).toString(),
          assetValue: toBigInt(input.assetValue).toString(),
          debtValue: toBigInt(input.debtValue).toString(),
          receivableValue: toBigInt(input.receivableValue).toString(),
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

      return updated;
    }

    const created = await tx
      .insertInto("opening_balances")
      .values({
        id: randomUUID(),
        businessId,
        cashBalance: toBigInt(input.cashBalance).toString(),
        nonCashBalance: toBigInt(input.nonCashBalance).toString(),
        inventoryValue: toBigInt(input.inventoryValue).toString(),
        assetValue: toBigInt(input.assetValue).toString(),
        debtValue: toBigInt(input.debtValue).toString(),
        receivableValue: toBigInt(input.receivableValue).toString(),
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

    return created;
  });
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
