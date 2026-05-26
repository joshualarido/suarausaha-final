import type { FinancialWriteTx } from "../../lib/financial-write.js";
import {
  reverseLatestTransactionForBusiness as reverseLatestTransactionForBusinessCore,
  reverseLatestTransactionForBusinessInTransaction as reverseLatestTransactionForBusinessInTransactionCore,
  type ReverseLatestTransactionInput,
  type ReverseLatestTransactionResult,
} from "./reversal.service.js";
import { createBaseTransactionInTransaction } from "./transaction-write.service.js";

export * from "./transaction-types.js";
export * from "./transaction-write.service.js";
export * from "./transaction-history.service.js";
export * from "./transaction-summaries.service.js";

export type { ReverseLatestTransactionInput, ReverseLatestTransactionResult };

export async function reverseLatestTransactionForBusinessInTransaction(
  tx: FinancialWriteTx,
  input: ReverseLatestTransactionInput,
): Promise<ReverseLatestTransactionResult> {
  return reverseLatestTransactionForBusinessInTransactionCore(tx, input, createBaseTransactionInTransaction);
}

export async function reverseLatestTransactionForBusiness(
  input: ReverseLatestTransactionInput,
): Promise<ReverseLatestTransactionResult> {
  return reverseLatestTransactionForBusinessCore(input, createBaseTransactionInTransaction);
}
