import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { createEnvConfig } from "../src/config/env.js";

const productionEnv = {
  NODE_ENV: "production",
  PORT: "3000",
  API_BASE_URL: "https://suarausaha-api.onrender.com",
  FRONTEND_ORIGIN: "https://suarausaha-web.onrender.com",
  BETTER_AUTH_SECRET: "a-production-secret-that-is-long-enough",
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  GEMINI_API_KEY: "gemini-api-key",
  GEMINI_MODEL: "gemini-3.1-flash-lite",
  PARSER_ENGINE: "gemini",
  DATABASE_URL: "postgresql://postgres:password@db.example.supabase.co:5432/postgres?sslmode=require",
} satisfies NodeJS.ProcessEnv;

describe("env config", () => {
  it("keeps local development defaults outside production", () => {
    const env = createEnvConfig({});

    expect(env.NODE_ENV).toBe("development");
    expect(env.API_BASE_URL).toBe("http://localhost:3000");
    expect(env.FRONTEND_ORIGIN).toBe("http://localhost:5173");
  });

  it("accepts complete production configuration", () => {
    const env = createEnvConfig(productionEnv);

    expect(env.NODE_ENV).toBe("production");
    expect(env.API_BASE_URL).toBe("https://suarausaha-api.onrender.com");
  });

  it("rejects placeholder secrets in production", () => {
    expect(() =>
      createEnvConfig({
        ...productionEnv,
        BETTER_AUTH_SECRET: "replace-with-a-long-random-secret",
      }),
    ).toThrow(ZodError);
  });

  it("requires Gemini key when Gemini parser is enabled in production", () => {
    const { GEMINI_API_KEY: _geminiApiKey, ...envWithoutGeminiKey } = productionEnv;

    expect(() => createEnvConfig(envWithoutGeminiKey)).toThrow(ZodError);
  });
});
