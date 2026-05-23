import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const apiBaseUrl = process.env.API_BASE_URL ?? process.env.BETTER_AUTH_URL;

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  API_BASE_URL: z.string().url().default("http://localhost:3000"),
  FRONTEND_ORIGIN: z.string().url().default("http://localhost:5173"),
  BETTER_AUTH_SECRET: z.string().min(16).default("development-secret-not-for-prod"),
  GOOGLE_CLIENT_ID: z.string().min(1).default("dev-google-client-id"),
  GOOGLE_CLIENT_SECRET: z.string().min(1).default("dev-google-client-secret"),
  DATABASE_URL: z.string().min(1).default("postgresql://postgres:postgres@localhost:5432/suarausaha_dev?schema=public"),
});

export const env = envSchema.parse({
  ...process.env,
  API_BASE_URL: apiBaseUrl,
});
