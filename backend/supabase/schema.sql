-- SuaraUsaha MVP core schema on Supabase Postgres
-- Auth tables expected by Better Auth + business table for MVP phase 1.

CREATE TABLE IF NOT EXISTS "user" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL,
  "image" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

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

CREATE TABLE IF NOT EXISTS "verification" (
  "id" text PRIMARY KEY,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz DEFAULT now(),
  "updatedAt" timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "business" (
  "id" text PRIMARY KEY,
  "ownerId" text NOT NULL UNIQUE REFERENCES "user"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "currency" text NOT NULL DEFAULT 'IDR',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

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

CREATE INDEX IF NOT EXISTS "menu_items_business_status_idx"
ON "menu_items" ("businessId", "status");

CREATE TABLE IF NOT EXISTS "payment_accounts" (
  "id" text PRIMARY KEY,
  "businessId" text NOT NULL REFERENCES "business"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "type" text NOT NULL CHECK ("type" IN ('cash', 'non_cash')),
  "currentBalance" bigint NOT NULL DEFAULT 0 CHECK ("currentBalance" >= 0),
  "isDefault" boolean NOT NULL DEFAULT false,
  "status" text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'inactive')),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("businessId", "name")
);

CREATE INDEX IF NOT EXISTS "payment_accounts_business_status_idx"
ON "payment_accounts" ("businessId", "status");

CREATE TABLE IF NOT EXISTS "opening_balances" (
  "id" text PRIMARY KEY,
  "businessId" text NOT NULL UNIQUE REFERENCES "business"("id") ON DELETE CASCADE,
  "cashBalance" bigint NOT NULL CHECK ("cashBalance" >= 0),
  "nonCashBalance" bigint NOT NULL CHECK ("nonCashBalance" >= 0),
  "inventoryValue" bigint NOT NULL CHECK ("inventoryValue" >= 0),
  "assetValue" bigint NOT NULL CHECK ("assetValue" >= 0),
  "debtValue" bigint NOT NULL CHECK ("debtValue" >= 0),
  "receivableValue" bigint NOT NULL CHECK ("receivableValue" >= 0),
  "openingAssets" bigint NOT NULL,
  "openingLiabilities" bigint NOT NULL,
  "openingEquity" bigint NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('pending', 'confirmed')),
  "confirmedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

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
  "confidence" numeric(5,4),
  "structuredPayload" jsonb NOT NULL,
  "missingFields" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "validationErrors" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status" text NOT NULL CHECK ("status" IN ('parsed', 'needs_clarification', 'failed')),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "confirmation_requests" (
  "id" text PRIMARY KEY,
  "businessId" text NOT NULL REFERENCES "business"("id") ON DELETE CASCADE,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  "parsedCommandId" text REFERENCES "parsed_commands"("id") ON DELETE SET NULL,
  "type" text NOT NULL CHECK ("type" IN ('transaction')),
  "status" text NOT NULL CHECK ("status" IN ('pending', 'confirmed', 'cancelled', 'expired', 'failed')),
  "proposedActionJson" jsonb NOT NULL,
  "summaryText" text NOT NULL,
  "warningText" text,
  "expectedEffectsJson" jsonb NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "confirmedAt" timestamptz,
  "cancelledAt" timestamptz,
  "resultingTransactionId" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "chat_sessions" (
  "id" text PRIMARY KEY,
  "businessId" text NOT NULL REFERENCES "business"("id") ON DELETE CASCADE,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  "status" text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'closed')),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

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

CREATE INDEX IF NOT EXISTS "transaction_effects_transaction_idx"
ON "transaction_effects" ("transactionId");

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
