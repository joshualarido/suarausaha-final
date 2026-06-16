import request from "supertest";
import { makeSignature } from "better-auth/crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/features/auth/auth.js", () => {
  return {
    auth: {
      api: {
        getSession: vi.fn(),
      },
    },
  };
});

vi.mock("../src/lib/database.js", () => {
  const insertExecute = vi.fn();
  const deleteExecute = vi.fn();
  const executeTakeFirst = vi.fn();

  return {
    db: {
      insertInto: vi.fn(() => ({
        values: vi.fn(() => ({
          execute: insertExecute,
        })),
      })),
      selectFrom: vi.fn(() => ({
        select: vi.fn(() => ({
          where: vi.fn(() => ({
            executeTakeFirst,
          })),
        })),
      })),
      deleteFrom: vi.fn(() => ({
        where: vi.fn(() => ({
          execute: deleteExecute,
        })),
      })),
    },
    __handoffDbMocks: {
      insertExecute,
      deleteExecute,
      executeTakeFirst,
    },
  };
});

import { app } from "../src/app.js";
import { env } from "../src/config/env.js";
import { auth } from "../src/features/auth/auth.js";
import { __handoffDbMocks } from "../src/lib/database.js";

describe("session handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __handoffDbMocks.insertExecute.mockResolvedValue(undefined);
    __handoffDbMocks.deleteExecute.mockResolvedValue(undefined);
  });

  it("creates a one-use handoff and redirects to the web-origin claim route", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      session: {
        token: "session-token",
      },
      user: {
        id: "user_123",
      },
    } as never);

    const response = await request(app).get(
      "/api/auth/session-handoff/start?next=https%3A%2F%2Flocalhost%3A5173%2Fonboarding%2Fbusiness",
    );

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain("http://localhost:5173/api/auth/session-handoff/claim?token=");
    expect(response.headers.location).toContain("next=http%3A%2F%2Flocalhost%3A5173%2Fonboarding%2Fbusiness");
  });

  it("sets a signed session cookie when a valid handoff is claimed", async () => {
    __handoffDbMocks.executeTakeFirst.mockResolvedValue({
      value: "session-token",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const response = await request(app).get(
      "/api/auth/session-handoff/claim?token=handoff-token&next=http%3A%2F%2Flocalhost%3A5173%2Fonboarding%2Fbusiness",
    );

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("http://localhost:5173/onboarding/business");
    expect(response.headers["set-cookie"][0]).toContain("__Secure-better-auth.session_token=");
    expect(response.headers["set-cookie"][0]).toContain(
      `session-token.${await makeSignature("session-token", env.BETTER_AUTH_SECRET)}`,
    );
    expect(response.headers["set-cookie"][0]).toContain("SameSite=Lax");
    expect(__handoffDbMocks.deleteExecute).toHaveBeenCalledOnce();
  });
});
