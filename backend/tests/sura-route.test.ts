import request from "supertest";
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

vi.mock("../src/features/business/business.service.js", () => {
  return {
    findBusinessByOwnerId: vi.fn(),
  };
});

vi.mock("../src/features/sura/sura.service.js", () => {
  return {
    querySura: vi.fn(),
  };
});

import { app } from "../src/app.js";
import { auth } from "../src/features/auth/auth.js";
import { findBusinessByOwnerId } from "../src/features/business/business.service.js";
import { querySura } from "../src/features/sura/sura.service.js";

describe("sura route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated Sura queries", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);

    const response = await request(app).post("/api/v1/sura/query").send({
      message: "kas sekarang berapa?",
    });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message: "User is not logged in.",
      },
    });
  });

  it("answers analytics questions for the authenticated user's business", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: {
        id: "user_123",
        name: "Josh",
        email: "josh@example.com",
      },
      session: {
        id: "session_123",
        userId: "user_123",
        expiresAt: new Date(),
      },
    } as never);
    vi.mocked(findBusinessByOwnerId).mockResolvedValue({
      id: "biz_123",
      ownerId: "user_123",
      name: "Warung Test",
      currency: "IDR",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    vi.mocked(querySura).mockResolvedValue({
      type: "analytics_answer",
      intent: "current_cash_balance",
      answer: "Saldo kas usaha sekarang Rp250.000.",
      data: { cashBalance: 250000 },
      warnings: [],
    } as never);

    const response = await request(app).post("/api/v1/sura/query").send({
      message: "kas sekarang berapa?",
    });

    expect(response.status).toBe(200);
    expect(querySura).toHaveBeenCalledWith({
      businessId: "biz_123",
      userId: "user_123",
      message: "kas sekarang berapa?",
    });
    expect(response.body).toEqual({
      success: true,
      data: {
        type: "analytics_answer",
        intent: "current_cash_balance",
        answer: "Saldo kas usaha sekarang Rp250.000.",
        data: { cashBalance: 250000 },
        warnings: [],
      },
    });
  });

  it("returns a redirect response for write actions", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: {
        id: "user_123",
        name: "Josh",
        email: "josh@example.com",
      },
      session: {
        id: "session_123",
        userId: "user_123",
        expiresAt: new Date(),
      },
    } as never);
    vi.mocked(findBusinessByOwnerId).mockResolvedValue({
      id: "biz_123",
      ownerId: "user_123",
      name: "Warung Test",
      currency: "IDR",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    vi.mocked(querySura).mockResolvedValue({
      type: "write_action_redirect",
      intent: "write_action",
      answer: "Saya akan teruskan ke alur pencatatan transaksi.",
      data: { redirectTo: "/api/v1/chat/parse" },
      warnings: [],
    } as never);

    const response = await request(app).post("/api/v1/sura/query").send({
      message: "jual ayam geprek 500 ribu tunai",
    });

    expect(response.status).toBe(200);
    expect(response.body.data.type).toBe("write_action_redirect");
  });
});
