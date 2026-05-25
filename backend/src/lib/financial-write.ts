import type { Transaction } from "kysely";
import { db, type DatabaseSchema } from "./database.js";

export type FinancialWriteTx = Transaction<DatabaseSchema>;

export async function runFinancialWrite<T>(callback: (tx: FinancialWriteTx) => Promise<T>): Promise<T> {
  return db.transaction().execute(callback);
}
