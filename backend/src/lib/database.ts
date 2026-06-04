import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { env } from "../config/env.js";
import type { DatabaseSchema } from "./database.types.js";

export * from "./database.types.js";

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
