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
    updateBusinessNameForOwner: vi.fn(),
  };
});

vi.mock("../src/features/payment-accounts/payment-account.service.js", () => {
  return {
    listPaymentAccountsByBusinessId: vi.fn(),
    ensureDefaultPaymentAccountsForBusinessId: vi.fn(),
  };
});

import { app } from "../src/app.js";
import { auth } from "../src/features/auth/auth.js";
import { findBusinessByOwnerId } from "../src/features/business/business.service.js";
import {
  ensureDefaultPaymentAccountsForBusinessId,
  listPaymentAccountsByBusinessId,
} from "../src/features/payment-accounts/payment-account.service.js";

describe("payment account routes", () => {
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

  it("returns default payment accounts", async () => {
    vi.mocked(findBusinessByOwnerId).mockResolvedValue({
      id: "biz_123",
      ownerId: "user_123",
      name: "Warung Test",
      currency: "IDR",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    vi.mocked(listPaymentAccountsByBusinessId).mockResolvedValue([
      {
        id: "acct_cash",
        name: "Kas",
        type: "cash",
        currentBalance: "500000",
        isDefault: true,
        status: "active",
      },
      {
        id: "acct_noncash",
        name: "Bank / QRIS / E-wallet",
        type: "non_cash",
        currentBalance: "1000000",
        isDefault: false,
        status: "active",
      },
    ] as never);

    const response = await request(app).get("/api/v1/payment-accounts");

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([
      {
        id: "acct_cash",
        name: "Kas",
        type: "cash",
        currentBalance: 500_000,
        isDefault: true,
        status: "active",
      },
      {
        id: "acct_noncash",
        name: "Bank / QRIS / E-wallet",
        type: "non_cash",
        currentBalance: 1_000_000,
        isDefault: false,
        status: "active",
      },
    ]);
    expect(ensureDefaultPaymentAccountsForBusinessId).not.toHaveBeenCalled();
  });

  it("backfills missing default accounts before responding", async () => {
    vi.mocked(findBusinessByOwnerId).mockResolvedValue({
      id: "biz_123",
      ownerId: "user_123",
      name: "Warung Test",
      currency: "IDR",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    vi.mocked(listPaymentAccountsByBusinessId)
      .mockResolvedValueOnce([
        {
          id: "acct_cash",
          name: "Kas",
          type: "cash",
          currentBalance: "500000",
          isDefault: true,
          status: "active",
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          id: "acct_cash",
          name: "Kas",
          type: "cash",
          currentBalance: "500000",
          isDefault: true,
          status: "active",
        },
        {
          id: "acct_noncash",
          name: "Bank / QRIS / E-wallet",
          type: "non_cash",
          currentBalance: "1000000",
          isDefault: false,
          status: "active",
        },
      ] as never);

    const response = await request(app).get("/api/v1/payment-accounts");

    expect(response.status).toBe(200);
    expect(ensureDefaultPaymentAccountsForBusinessId).toHaveBeenCalledWith("biz_123");
    expect(listPaymentAccountsByBusinessId).toHaveBeenCalledTimes(2);
  });
});
