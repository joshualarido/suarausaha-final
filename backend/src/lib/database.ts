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

export interface DatabaseSchema {
  business: BusinessRow;
  payment_accounts: PaymentAccountRow;
  opening_balances: OpeningBalanceRow;
  transactions: TransactionRow;
}

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_URL.includes("sslmode=require") || env.DATABASE_URL.includes("sslmode=required")
    ? {
        rejectUnauthorized: false,
      }
    : undefined,
});

export const db = new Kysely<DatabaseSchema>({
  dialect: new PostgresDialect({ pool }),
});

export async function ensureDatabaseSchema(): Promise<void> {
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
    CREATE TABLE IF NOT EXISTS "transactions" (
      "id" text PRIMARY KEY,
      "businessId" text NOT NULL REFERENCES "business"("id") ON DELETE CASCADE,
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
}
