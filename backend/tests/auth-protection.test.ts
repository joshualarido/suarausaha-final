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
    createBusinessForOwner: vi.fn(),
    updateBusinessNameForOwner: vi.fn(),
    getBusinessOnboardingContextForOwner: vi.fn(),
  };
});

import { app } from "../src/app.js";
import { auth } from "../src/features/auth/auth.js";
import { getBusinessOnboardingContextForOwner } from "../src/features/business/business.service.js";

describe("auth protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated /me requests", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);

    const response = await request(app).get("/api/v1/me");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message: "User is not logged in.",
      },
    });
  });

  it("returns user context for authenticated /me requests", async () => {
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

    vi.mocked(getBusinessOnboardingContextForOwner).mockResolvedValue({
      business: {
        id: "biz_123",
      },
      hasBusiness: true,
      hasCompletedOpeningBalance: false,
      onboardingStatus: "opening_balance_pending",
    } as never);

    const response = await request(app).get("/api/v1/me");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        id: "user_123",
        name: "Josh",
        email: "josh@example.com",
        hasBusiness: true,
        businessId: "biz_123",
        onboardingStatus: "opening_balance_pending",
      },
    });
  });
});
