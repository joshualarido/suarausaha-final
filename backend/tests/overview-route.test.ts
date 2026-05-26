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

vi.mock("../src/features/overview/overview.service.js", () => {
  return {
    getOverviewByBusinessId: vi.fn(),
  };
});

import { app } from "../src/app.js";
import { auth } from "../src/features/auth/auth.js";
import { findBusinessByOwnerId } from "../src/features/business/business.service.js";
import { getOverviewByBusinessId } from "../src/features/overview/overview.service.js";

describe("overview route", () => {
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

    vi.mocked(findBusinessByOwnerId).mockResolvedValue({
      id: "biz_123",
      ownerId: "user_123",
      name: "Warung Test",
      currency: "IDR",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
  });

  it("returns overview data for the authenticated business", async () => {
    vi.mocked(getOverviewByBusinessId).mockResolvedValue({
      asOfDate: "2026-05-25",
      summaryCards: {
        totalBusinessMoney: 1_750_000,
        cashBalance: 750_000,
        nonCashBalance: 1_000_000,
        receivableOutstanding: 300_000,
        liabilityOutstanding: 500_000,
        inventoryEstimated: 800_000,
      },
      accountBalances: {
        cashBalance: 750_000,
        nonCashBalance: 1_000_000,
        totalBalance: 1_750_000,
      },
      monthlyActivity: {
        fromDate: "2026-05-01",
        toDate: "2026-05-31",
        moneyIn: 3_200_000,
        moneyOut: 1_450_000,
        difference: 1_750_000,
      },
      receivables: {
        totalOutstanding: 300_000,
        activeCount: 2,
        items: [],
      },
      liabilities: {
        totalOutstanding: 500_000,
        activeCount: 1,
        items: [],
      },
      warnings: {
        isCashLow: false,
        pendingConfirmationCount: 1,
        reversedTransactionCountToday: 0,
      },
      latestConfirmedTransactions: [],
      notes: {
        inventory: "Nilai persediaan masih berupa estimasi.",
        monthlyActivity: "Ringkasan aktivitas uang bulan ini. Ini bukan laba.",
      },
    } as never);

    const response = await request(app).get("/api/v1/overview?fromDate=2026-05-01&toDate=2026-05-31");

    expect(response.status).toBe(200);
    expect(getOverviewByBusinessId).toHaveBeenCalledWith({
      businessId: "biz_123",
      userId: "user_123",
      fromDate: "2026-05-01",
      toDate: "2026-05-31",
    });
    expect(response.body.success).toBe(true);
    expect(response.body.data.summaryCards.totalBusinessMoney).toBe(1_750_000);
    expect(response.body.data.monthlyActivity.moneyIn).toBe(3_200_000);
  });

  it("returns validation error for invalid overview query", async () => {
    const response = await request(app).get("/api/v1/overview?fromDate=not-a-date");

    expect(response.status).toBe(400);
    expect(getOverviewByBusinessId).not.toHaveBeenCalled();
  });

  it("returns 404 if authenticated user has no business", async () => {
    vi.mocked(findBusinessByOwnerId).mockResolvedValue(null as never);

    const response = await request(app).get("/api/v1/overview");

    expect(response.status).toBe(404);
    expect(getOverviewByBusinessId).not.toHaveBeenCalled();
  });
});
