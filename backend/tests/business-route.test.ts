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
    getBusinessOnboardingContextForOwner: vi.fn(),
    createBusinessForOwner: vi.fn(),
    resetBusinessForOwner: vi.fn(),
    updateBusinessNameForOwner: vi.fn(),
  };
});

import { app } from "../src/app.js";
import { auth } from "../src/features/auth/auth.js";
import {
  createBusinessForOwner,
  getBusinessOnboardingContextForOwner,
  resetBusinessForOwner,
  updateBusinessNameForOwner,
} from "../src/features/business/business.service.js";

describe("business routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  it("returns business profile with onboarding fields", async () => {
    vi.mocked(getBusinessOnboardingContextForOwner).mockResolvedValue({
      business: {
        id: "business_123",
        ownerId: "user_123",
        name: "Warung Test",
        currency: "IDR",
        createdAt: new Date("2026-05-12T10:00:00Z"),
        updatedAt: new Date("2026-05-12T10:00:00Z"),
      },
      hasBusiness: true,
      hasCompletedOpeningBalance: false,
      onboardingStatus: "opening_balance_pending",
    } as never);

    const response = await request(app).get("/api/v1/business");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        id: "business_123",
        name: "Warung Test",
        currency: "IDR",
        hasCompletedOpeningBalance: false,
        onboardingStatus: "opening_balance_pending",
        createdAt: "2026-05-12T10:00:00.000Z",
      },
    });
  });

  it("creates one business for a user and returns onboarding fields", async () => {
    vi.mocked(getBusinessOnboardingContextForOwner)
      .mockResolvedValueOnce({
        business: null,
        hasBusiness: false,
        hasCompletedOpeningBalance: false,
        onboardingStatus: "profile_created",
      } as never)
      .mockResolvedValueOnce({
        business: {
          id: "business_123",
          ownerId: "user_123",
          name: "Warung Test",
          currency: "IDR",
          createdAt: new Date("2026-05-12T10:00:00Z"),
          updatedAt: new Date("2026-05-12T10:00:00Z"),
        },
        hasBusiness: true,
        hasCompletedOpeningBalance: false,
        onboardingStatus: "opening_balance_pending",
      } as never);

    vi.mocked(createBusinessForOwner).mockResolvedValue({
      id: "business_123",
      ownerId: "user_123",
      name: "Warung Test",
      currency: "IDR",
      createdAt: new Date("2026-05-12T10:00:00Z"),
      updatedAt: new Date("2026-05-12T10:00:00Z"),
    } as never);

    const response = await request(app).post("/api/v1/business").send({
      name: "Warung Test",
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      success: true,
      data: {
        id: "business_123",
        name: "Warung Test",
        currency: "IDR",
        hasCompletedOpeningBalance: false,
        onboardingStatus: "opening_balance_pending",
        createdAt: "2026-05-12T10:00:00.000Z",
      },
    });
  });

  it("blocks second business creation", async () => {
    vi.mocked(getBusinessOnboardingContextForOwner).mockResolvedValue({
      business: {
        id: "business_existing",
        ownerId: "user_123",
        name: "Existing Business",
        currency: "IDR",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      hasBusiness: true,
      hasCompletedOpeningBalance: false,
      onboardingStatus: "opening_balance_pending",
    } as never);

    const response = await request(app).post("/api/v1/business").send({
      name: "Another Business",
    });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "MVP supports one business per user.",
      },
    });
  });

  it("updates business name with PATCH /business", async () => {
    vi.mocked(updateBusinessNameForOwner).mockResolvedValue({
      id: "business_123",
      ownerId: "user_123",
      name: "Warung Baru",
      currency: "IDR",
      createdAt: new Date("2026-05-12T10:00:00Z"),
      updatedAt: new Date("2026-05-13T10:00:00Z"),
    } as never);

    vi.mocked(getBusinessOnboardingContextForOwner).mockResolvedValue({
      business: {
        id: "business_123",
        ownerId: "user_123",
        name: "Warung Baru",
        currency: "IDR",
        createdAt: new Date("2026-05-12T10:00:00Z"),
        updatedAt: new Date("2026-05-13T10:00:00Z"),
      },
      hasBusiness: true,
      hasCompletedOpeningBalance: true,
      onboardingStatus: "active",
    } as never);

    const response = await request(app).patch("/api/v1/business").send({
      name: "Warung Baru",
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        id: "business_123",
        name: "Warung Baru",
        currency: "IDR",
        hasCompletedOpeningBalance: true,
        onboardingStatus: "active",
        createdAt: "2026-05-12T10:00:00.000Z",
      },
    });
  });

  it("rejects PATCH /business with empty name", async () => {
    const response = await request(app).patch("/api/v1/business").send({
      name: "   ",
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Business name is required.",
      },
    });
  });

  it("returns 404 when patching business that does not exist", async () => {
    vi.mocked(updateBusinessNameForOwner).mockResolvedValue(null);

    const response = await request(app).patch("/api/v1/business").send({
      name: "Warung Baru",
    });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Business profile not found.",
      },
    });
  });

  it("resets onboarding state through debug endpoint in non-production mode", async () => {
    vi.mocked(resetBusinessForOwner).mockResolvedValue(true as never);

    const response = await request(app).post("/api/v1/debug/reset-onboarding").send({});

    expect(response.status).toBe(200);
    expect(resetBusinessForOwner).toHaveBeenCalledWith("user_123");
    expect(response.body).toEqual({
      success: true,
      data: {
        reset: true,
      },
    });
  });
});
