import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const DEVELOPMENT_DEFAULTS = {
  API_BASE_URL: "http://localhost:3000",
  FRONTEND_ORIGIN: "http://localhost:5173",
  BETTER_AUTH_SECRET: "development-secret-not-for-prod",
  GOOGLE_CLIENT_ID: "dev-google-client-id",
  GOOGLE_CLIENT_SECRET: "dev-google-client-secret",
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/suarausaha_dev?schema=public",
};

const PLACEHOLDER_PATTERNS = [
  "replace-with",
  "development-secret",
  "dev-google",
  "[your_",
  "[project-ref]",
];

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  API_BASE_URL: z.string().url(),
  FRONTEND_ORIGIN: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(16),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().min(1).default("gemini-3.1-flash-lite"),
  PARSER_ENGINE: z.enum(["gemini", "deterministic"]).default("deterministic"),
  DATABASE_URL: z.string().min(1),
}).superRefine((value, ctx) => {
  if (value.NODE_ENV !== "production") return;

  for (const [key, rawValue] of Object.entries(value)) {
    if (typeof rawValue !== "string") continue;

    const normalized = rawValue.trim().toLowerCase();
    const isPlaceholder = PLACEHOLDER_PATTERNS.some((pattern) => normalized.includes(pattern));
    if (isPlaceholder) {
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: `${key} must be configured with a real production value.`,
      });
    }
  }

  if (value.BETTER_AUTH_SECRET.length < 32) {
    ctx.addIssue({
      code: "custom",
      path: ["BETTER_AUTH_SECRET"],
      message: "BETTER_AUTH_SECRET must be at least 32 characters in production.",
    });
  }

  if (value.PARSER_ENGINE === "gemini" && !value.GEMINI_API_KEY) {
    ctx.addIssue({
      code: "custom",
      path: ["GEMINI_API_KEY"],
      message: "GEMINI_API_KEY is required when PARSER_ENGINE is gemini in production.",
    });
  }

  if (value.DATABASE_URL.includes("localhost") || value.DATABASE_URL.includes("127.0.0.1")) {
    ctx.addIssue({
      code: "custom",
      path: ["DATABASE_URL"],
      message: "DATABASE_URL must not point to localhost in production.",
    });
  }
});

function valueOrDevelopmentDefault(
  input: NodeJS.ProcessEnv,
  key: keyof typeof DEVELOPMENT_DEFAULTS,
  nodeEnv: string,
): string | undefined {
  const value = input[key];
  if (value && value.trim()) return value;
  return nodeEnv === "production" ? undefined : DEVELOPMENT_DEFAULTS[key];
}

export function createEnvConfig(input: NodeJS.ProcessEnv = process.env) {
  const nodeEnv = input.NODE_ENV ?? "development";
  const apiBaseUrl = input.API_BASE_URL?.trim() || input.BETTER_AUTH_URL?.trim();

  return envSchema.parse({
    ...input,
    NODE_ENV: nodeEnv,
    API_BASE_URL: apiBaseUrl ?? valueOrDevelopmentDefault(input, "API_BASE_URL", nodeEnv),
    FRONTEND_ORIGIN: valueOrDevelopmentDefault(input, "FRONTEND_ORIGIN", nodeEnv),
    BETTER_AUTH_SECRET: valueOrDevelopmentDefault(input, "BETTER_AUTH_SECRET", nodeEnv),
    GOOGLE_CLIENT_ID: valueOrDevelopmentDefault(input, "GOOGLE_CLIENT_ID", nodeEnv),
    GOOGLE_CLIENT_SECRET: valueOrDevelopmentDefault(input, "GOOGLE_CLIENT_SECRET", nodeEnv),
    DATABASE_URL: valueOrDevelopmentDefault(input, "DATABASE_URL", nodeEnv),
  });
}

export const env = createEnvConfig();
