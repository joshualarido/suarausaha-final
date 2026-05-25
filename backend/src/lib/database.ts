import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { env } from "../config/env.js";

export interface BusinessRow {
  id: string;
  ownerId: string;
  name: string;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentAccountRow {
  id: string;
  businessId: string;
  name: string;
  type: "cash" | "non_cash";
  currentBalance: string;
  isDefault: boolean;
  status: "active" | "inactive";
  createdAt: Date;
  updatedAt: Date;
}

export interface MenuItemRow {
  id: string;
  businessId: string;
  name: string;
  aliases: unknown;
  defaultPrice: string | null;
  category: string | null;
  status: "active" | "inactive";
  createdAt: Date;
  updatedAt: Date;
}

export interface OpeningBalanceRow {
  id: string;
  businessId: string;
  cashBalance: string;
  nonCashBalance: string;
  inventoryValue: string;
  assetValue: string;
  debtValue: string;
  receivableValue: string;
  openingAssets: string;
  openingLiabilities: string;
  openingEquity: string;
  status: "pending" | "confirmed";
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TransactionRow {
  id: string;
  businessId: string;
  confirmationRequestId: string | null;
  parsedCommandId: string | null;
  paymentAccountId: string | null;
  type: string;
  amount: string;
  transactionDate: string;
  description: string;
  status: "confirmed" | "reversed";
  isReversal: boolean;
  reversedAt: Date | null;
  createdAt: Date;
  createdBy: string;
}

export interface TransactionEffectRow {
  id: string;
  transactionId: string;
  businessId: string;
  targetType: string;
  targetId: string;
  effectType: string;
  direction: "increase" | "decrease";
  amount: string;
  beforeAmount: string;
  afterAmount: string;
  createdAt: Date;
}

export interface InventorySummaryRow {
  id: string;
  businessId: string;
  name: string;
  estimatedValue: string;
  sourceOpeningBalanceId: string | null;
  sourceTransactionId: string | null;
  lastUpdatedAt: Date;
  status: "active" | "inactive";
  createdAt: Date;
  updatedAt: Date;
}

export interface AssetSummaryRow {
  id: string;
  businessId: string;
  name: string;
  value: string;
  recordedDate: string;
  sourceOpeningBalanceId: string | null;
  sourceTransactionId: string | null;
  status: "active" | "inactive";
  createdAt: Date;
  updatedAt: Date;
}

export interface LiabilityRow {
  id: string;
  businessId: string;
  lenderName: string;
  description: string | null;
  originalAmount: string;
  outstandingAmount: string;
  createdDate: string;
  status: "open" | "partial" | "paid";
  sourceOpeningBalanceId: string | null;
  sourceTransactionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReceivableRow {
  id: string;
  businessId: string;
  customerName: string;
  description: string | null;
  originalAmount: string;
  outstandingAmount: string;
  createdDate: string;
  status: "open" | "partial" | "paid";
  sourceOpeningBalanceId: string | null;
  sourceTransactionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TransactionCorrectionRow {
  id: string;
  businessId: string;
  originalTransactionId: string;
  reversalTransactionId: string;
  reason: string | null;
  status: "applied" | "failed";
  createdAt: Date;
  createdBy: string;
}

export interface ParsedCommandRow {
  id: string;
  businessId: string;
  userId: string;
  rawInputText: string;
  normalizedInputText: string | null;
  source: "text";
  detectedIntent: string | null;
  parserModel: string;
  parserVersion: string;
  confidence: string | null;
  structuredPayload: unknown;
  missingFields: unknown;
  validationErrors: unknown;
  status: "parsed" | "needs_clarification" | "failed";
  createdAt: Date;
  updatedAt: Date;
}

export interface ConfirmationRequestRow {
  id: string;
  businessId: string;
  userId: string;
  parsedCommandId: string | null;
  type: "transaction";
  status: "pending" | "confirmed" | "cancelled" | "expired" | "failed";
  proposedActionJson: unknown;
  summaryText: string;
  warningText: string | null;
  expectedEffectsJson: unknown;
  expiresAt: Date;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  resultingTransactionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatSessionRow {
  id: string;
  businessId: string;
  userId: string;
  status: "active" | "closed";
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatMessageRow {
  id: string;
  sessionId: string;
  businessId: string;
  userId: string;
  role: "user" | "assistant";
  kind: "text" | "clarification" | "confirmation_card" | "system_result";
  contentJson: unknown;
  parsedCommandId: string | null;
  confirmationRequestId: string | null;
  transactionId: string | null;
  createdAt: Date;
}

export interface DatabaseSchema {
  user: UserRow;
  business: BusinessRow;
  payment_accounts: PaymentAccountRow;
  menu_items: MenuItemRow;
  opening_balances: OpeningBalanceRow;
  parsed_commands: ParsedCommandRow;
  confirmation_requests: ConfirmationRequestRow;
  chat_sessions: ChatSessionRow;
  chat_messages: ChatMessageRow;
  transactions: TransactionRow;
  transaction_effects: TransactionEffectRow;
  inventory_summaries: InventorySummaryRow;
  asset_summaries: AssetSummaryRow;
  liabilities: LiabilityRow;
  receivables: ReceivableRow;
  transaction_corrections: TransactionCorrectionRow;
}

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 8,
  min: 1,
  connectionTimeoutMillis: 10_000,
  ssl: env.DATABASE_URL.includes("sslmode=require") || env.DATABASE_URL.includes("sslmode=required")
    ? {
        rejectUnauthorized: false,
      }
    : undefined,
});

pool.on("error", (err) => {
  console.error("Unexpected database pool error:", err);
});

export const db = new Kysely<DatabaseSchema>({
  dialect: new PostgresDialect({ pool }),
});

let schemaEnsured = false;

export async function ensureDatabaseSchema(): Promise<void> {
  if (schemaEnsured) return;

  try {
  await sql`
    CREATE TABLE IF NOT EXISTS "user" (
      "id" text PRIMARY KEY,
      "name" text NOT NULL,
      "email" text NOT NULL UNIQUE,
      "emailVerified" boolean NOT NULL,
      "image" text,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    );
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS "session" (
      "id" text PRIMARY KEY,
      "expiresAt" timestamptz NOT NULL,
      "token" text NOT NULL UNIQUE,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "ipAddress" text,
      "userAgent" text,
      "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
    );
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS "account" (
      "id" text PRIMARY KEY,
      "accountId" text NOT NULL,
      "providerId" text NOT NULL,
      "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      "accessToken" text,
      "refreshToken" text,
      "idToken" text,
      "accessTokenExpiresAt" timestamptz,
      "refreshTokenExpiresAt" timestamptz,
      "scope" text,
      "password" text,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      UNIQUE ("providerId", "accountId")
    );
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS "verification" (
      "id" text PRIMARY KEY,
      "identifier" text NOT NULL,
      "value" text NOT NULL,
      "expiresAt" timestamptz NOT NULL,
      "createdAt" timestamptz DEFAULT now(),
      "updatedAt" timestamptz DEFAULT now()
    );
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS "business" (
      "id" text PRIMARY KEY,
      "ownerId" text NOT NULL UNIQUE,
      "name" text NOT NULL,
      "currency" text NOT NULL DEFAULT 'IDR',
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE CASCADE
    );
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS "payment_accounts" (
      "id" text PRIMARY KEY,
      "businessId" text NOT NULL REFERENCES "business"("id") ON DELETE CASCADE,
      "name" text NOT NULL,
      "type" text NOT NULL CHECK ("type" IN ('cash', 'non_cash')),
      "currentBalance" bigint NOT NULL DEFAULT 0,
      "isDefault" boolean NOT NULL DEFAULT false,
      "status" text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'inactive')),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      UNIQUE ("businessId", "type")
    );
  `.execute(db);

  await sql`
    ALTER TABLE "payment_accounts"
    DROP CONSTRAINT IF EXISTS "payment_accounts_businessId_type_key";
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS "menu_items" (
      "id" text PRIMARY KEY,
      "businessId" text NOT NULL REFERENCES "business"("id") ON DELETE CASCADE,
      "name" text NOT NULL,
      "aliases" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "defaultPrice" bigint,
      "category" text,
      "status" text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'inactive')),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    );
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS "menu_items_business_status_idx"
    ON "menu_items" ("businessId", "status");
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS "opening_balances" (
      "id" text PRIMARY KEY,
      "businessId" text NOT NULL UNIQUE REFERENCES "business"("id") ON DELETE CASCADE,
      "cashBalance" bigint NOT NULL DEFAULT 0,
      "nonCashBalance" bigint NOT NULL DEFAULT 0,
      "inventoryValue" bigint NOT NULL DEFAULT 0,
      "assetValue" bigint NOT NULL DEFAULT 0,
      "debtValue" bigint NOT NULL DEFAULT 0,
      "receivableValue" bigint NOT NULL DEFAULT 0,
      "openingAssets" bigint NOT NULL,
      "openingLiabilities" bigint NOT NULL,
      "openingEquity" bigint NOT NULL,
      "status" text NOT NULL CHECK ("status" IN ('pending', 'confirmed')),
      "confirmedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    );
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS "parsed_commands" (
      "id" text PRIMARY KEY,
      "businessId" text NOT NULL REFERENCES "business"("id") ON DELETE CASCADE,
      "userId" text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
      "rawInputText" text NOT NULL,
      "normalizedInputText" text,
      "source" text NOT NULL DEFAULT 'text' CHECK ("source" IN ('text')),
      "detectedIntent" text,
      "parserModel" text NOT NULL,
      "parserVersion" text NOT NULL,
      "confidence" numeric,
      "structuredPayload" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "missingFields" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "validationErrors" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "status" text NOT NULL CHECK ("status" IN ('parsed', 'needs_clarification', 'failed')),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    );
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS "confirmation_requests" (
      "id" text PRIMARY KEY,
      "businessId" text NOT NULL REFERENCES "business"("id") ON DELETE CASCADE,
      "userId" text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
      "parsedCommandId" text REFERENCES "parsed_commands"("id") ON DELETE SET NULL,
      "type" text NOT NULL DEFAULT 'transaction' CHECK ("type" IN ('transaction')),
      "status" text NOT NULL CHECK ("status" IN ('pending', 'confirmed', 'cancelled', 'expired', 'failed')),
      "proposedActionJson" jsonb NOT NULL,
      "summaryText" text NOT NULL,
      "warningText" text,
      "expectedEffectsJson" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "expiresAt" timestamptz NOT NULL,
      "confirmedAt" timestamptz,
      "cancelledAt" timestamptz,
      "resultingTransactionId" text,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    );
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS "chat_sessions" (
      "id" text PRIMARY KEY,
      "businessId" text NOT NULL REFERENCES "business"("id") ON DELETE CASCADE,
      "userId" text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
      "status" text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'closed')),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    );
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS "chat_messages" (
      "id" text PRIMARY KEY,
      "sessionId" text NOT NULL REFERENCES "chat_sessions"("id") ON DELETE CASCADE,
      "businessId" text NOT NULL REFERENCES "business"("id") ON DELETE CASCADE,
      "userId" text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
      "role" text NOT NULL CHECK ("role" IN ('user', 'assistant')),
      "kind" text NOT NULL CHECK ("kind" IN ('text', 'clarification', 'confirmation_card', 'system_result')),
      "contentJson" jsonb NOT NULL,
      "parsedCommandId" text REFERENCES "parsed_commands"("id") ON DELETE SET NULL,
      "confirmationRequestId" text REFERENCES "confirmation_requests"("id") ON DELETE SET NULL,
      "transactionId" text REFERENCES "transactions"("id") ON DELETE SET NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    );
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS "transactions" (
      "id" text PRIMARY KEY,
      "businessId" text NOT NULL REFERENCES "business"("id") ON DELETE CASCADE,
      "confirmationRequestId" text REFERENCES "confirmation_requests"("id") ON DELETE SET NULL,
      "parsedCommandId" text REFERENCES "parsed_commands"("id") ON DELETE SET NULL,
      "paymentAccountId" text REFERENCES "payment_accounts"("id") ON DELETE SET NULL,
      "type" text NOT NULL,
      "amount" bigint NOT NULL CHECK ("amount" > 0),
      "transactionDate" date NOT NULL,
      "description" text NOT NULL,
      "status" text NOT NULL DEFAULT 'confirmed' CHECK ("status" IN ('confirmed', 'reversed')),
      "isReversal" boolean NOT NULL DEFAULT false,
      "reversedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "createdBy" text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT
    );
  `.execute(db);

  await sql`
    ALTER TABLE "transactions"
    ADD COLUMN IF NOT EXISTS "confirmationRequestId" text REFERENCES "confirmation_requests"("id") ON DELETE SET NULL;
  `.execute(db);

  await sql`
    ALTER TABLE "transactions"
    ADD COLUMN IF NOT EXISTS "parsedCommandId" text REFERENCES "parsed_commands"("id") ON DELETE SET NULL;
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS "transaction_effects" (
      "id" text PRIMARY KEY,
      "transactionId" text NOT NULL REFERENCES "transactions"("id") ON DELETE CASCADE,
      "businessId" text NOT NULL REFERENCES "business"("id") ON DELETE CASCADE,
      "targetType" text NOT NULL,
      "targetId" text NOT NULL,
      "effectType" text NOT NULL,
      "direction" text NOT NULL CHECK ("direction" IN ('increase', 'decrease')),
      "amount" bigint NOT NULL CHECK ("amount" > 0),
      "beforeAmount" bigint NOT NULL,
      "afterAmount" bigint NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    );
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS "transaction_effects_transaction_idx"
    ON "transaction_effects" ("transactionId");
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS "inventory_summaries" (
      "id" text PRIMARY KEY,
      "businessId" text NOT NULL REFERENCES "business"("id") ON DELETE CASCADE,
      "name" text NOT NULL,
      "estimatedValue" bigint NOT NULL DEFAULT 0,
      "sourceOpeningBalanceId" text REFERENCES "opening_balances"("id") ON DELETE SET NULL,
      "sourceTransactionId" text REFERENCES "transactions"("id") ON DELETE SET NULL,
      "lastUpdatedAt" timestamptz NOT NULL DEFAULT now(),
      "status" text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'inactive')),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    );
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS "asset_summaries" (
      "id" text PRIMARY KEY,
      "businessId" text NOT NULL REFERENCES "business"("id") ON DELETE CASCADE,
      "name" text NOT NULL,
      "value" bigint NOT NULL CHECK ("value" > 0),
      "recordedDate" date NOT NULL,
      "sourceOpeningBalanceId" text REFERENCES "opening_balances"("id") ON DELETE SET NULL,
      "sourceTransactionId" text REFERENCES "transactions"("id") ON DELETE SET NULL,
      "status" text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'inactive')),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    );
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS "liabilities" (
      "id" text PRIMARY KEY,
      "businessId" text NOT NULL REFERENCES "business"("id") ON DELETE CASCADE,
      "lenderName" text NOT NULL,
      "description" text,
      "originalAmount" bigint NOT NULL CHECK ("originalAmount" > 0),
      "outstandingAmount" bigint NOT NULL CHECK ("outstandingAmount" >= 0),
      "createdDate" date NOT NULL,
      "status" text NOT NULL DEFAULT 'open' CHECK ("status" IN ('open', 'partial', 'paid')),
      "sourceOpeningBalanceId" text REFERENCES "opening_balances"("id") ON DELETE SET NULL,
      "sourceTransactionId" text REFERENCES "transactions"("id") ON DELETE SET NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    );
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS "receivables" (
      "id" text PRIMARY KEY,
      "businessId" text NOT NULL REFERENCES "business"("id") ON DELETE CASCADE,
      "customerName" text NOT NULL,
      "description" text,
      "originalAmount" bigint NOT NULL CHECK ("originalAmount" > 0),
      "outstandingAmount" bigint NOT NULL CHECK ("outstandingAmount" >= 0),
      "createdDate" date NOT NULL,
      "status" text NOT NULL DEFAULT 'open' CHECK ("status" IN ('open', 'partial', 'paid')),
      "sourceOpeningBalanceId" text REFERENCES "opening_balances"("id") ON DELETE SET NULL,
      "sourceTransactionId" text REFERENCES "transactions"("id") ON DELETE SET NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    );
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS "transaction_corrections" (
      "id" text PRIMARY KEY,
      "businessId" text NOT NULL REFERENCES "business"("id") ON DELETE CASCADE,
      "originalTransactionId" text NOT NULL REFERENCES "transactions"("id") ON DELETE RESTRICT,
      "reversalTransactionId" text NOT NULL REFERENCES "transactions"("id") ON DELETE RESTRICT,
      "reason" text,
      "status" text NOT NULL DEFAULT 'applied' CHECK ("status" IN ('applied', 'failed')),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "createdBy" text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
      UNIQUE ("originalTransactionId")
    );
  `.execute(db);

    schemaEnsured = true;
  } catch (err) {
    console.error("Failed to ensure database schema:", err);
    throw err;
  }
}
