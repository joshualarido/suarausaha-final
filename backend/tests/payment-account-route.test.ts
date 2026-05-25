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
  class PaymentAccountAlreadyExistsError extends Error {
    constructor() {
      super("Payment account already exists.");
    }
  }

  class DefaultPaymentAccountRemovalError extends Error {
    constructor() {
      super("Default payment account cannot be removed.");
    }
  }

  class PaymentAccountNotFoundError extends Error {
    constructor() {
      super("Payment account not found for this business.");
    }
  }

  return {
    listPaymentAccountsByBusinessId: vi.fn(),
    ensureDefaultPaymentAccountsForBusinessId: vi.fn(),
    createPaymentAccountForBusiness: vi.fn(),
    deactivatePaymentAccountForBusiness: vi.fn(),
    setDefaultPaymentAccountForBusiness: vi.fn(),
    updatePaymentAccountNameForBusiness: vi.fn(),
    DefaultPaymentAccountRemovalError,
    PaymentAccountAlreadyExistsError,
    PaymentAccountNotFoundError,
  };
});

import { app } from "../src/app.js";
import { auth } from "../src/features/auth/auth.js";
import { findBusinessByOwnerId } from "../src/features/business/business.service.js";
import {
  createPaymentAccountForBusiness,
  DefaultPaymentAccountRemovalError,
  deactivatePaymentAccountForBusiness,
  ensureDefaultPaymentAccountsForBusinessId,
  listPaymentAccountsByBusinessId,
  PaymentAccountAlreadyExistsError,
  PaymentAccountNotFoundError,
  setDefaultPaymentAccountForBusiness,
  updatePaymentAccountNameForBusiness,
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

  it("returns the Kas default payment account", async () => {
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
    ] as never);

    const response = await request(app).get("/api/v1/payment-accounts");

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([
      {
        id: "acct_cash",
        name: "Kas",
        currentBalance: 500_000,
        isDefault: true,
        status: "active",
      },
    ]);
    expect(ensureDefaultPaymentAccountsForBusinessId).not.toHaveBeenCalled();
  });

  it("backfills a missing Kas account before responding", async () => {
    vi.mocked(findBusinessByOwnerId).mockResolvedValue({
      id: "biz_123",
      ownerId: "user_123",
      name: "Warung Test",
      currency: "IDR",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    vi.mocked(listPaymentAccountsByBusinessId)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([
        {
          id: "acct_cash",
          name: "Kas",
          type: "cash",
          currentBalance: "500000",
          isDefault: true,
          status: "active",
        },
      ] as never);

    const response = await request(app).get("/api/v1/payment-accounts");

    expect(response.status).toBe(200);
    expect(ensureDefaultPaymentAccountsForBusinessId).toHaveBeenCalledWith("biz_123");
    expect(listPaymentAccountsByBusinessId).toHaveBeenCalledTimes(2);
  });

  it("updates a payment account name", async () => {
    vi.mocked(findBusinessByOwnerId).mockResolvedValue({
      id: "biz_123",
      ownerId: "user_123",
      name: "Warung Test",
      currency: "IDR",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    vi.mocked(updatePaymentAccountNameForBusiness).mockResolvedValue({
      id: "acct_cash",
      businessId: "biz_123",
      name: "Kas Operasional",
      type: "non_cash",
      currentBalance: "500000",
      isDefault: true,
      status: "active",
    } as never);

    const response = await request(app).patch("/api/v1/payment-accounts/acct_cash").send({
      name: "Kas Operasional",
    });

    expect(response.status).toBe(200);
    expect(updatePaymentAccountNameForBusiness).toHaveBeenCalledWith("biz_123", "acct_cash", "Kas Operasional");
    expect(response.body.data.name).toBe("Kas Operasional");
  });

  it("returns 400 when updating payment account with empty name", async () => {
    const response = await request(app).patch("/api/v1/payment-accounts/acct_cash").send({
      name: "   ",
    });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe("Payment account name is required.");
  });

  it("returns 404 when payment account is not found for business", async () => {
    vi.mocked(findBusinessByOwnerId).mockResolvedValue({
      id: "biz_123",
      ownerId: "user_123",
      name: "Warung Test",
      currency: "IDR",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    vi.mocked(updatePaymentAccountNameForBusiness).mockRejectedValue(new PaymentAccountNotFoundError());

    const response = await request(app).patch("/api/v1/payment-accounts/acct_missing").send({
      name: "Kas Baru",
    });

    expect(response.status).toBe(404);
    expect(response.body.error.message).toBe("Payment account not found.");
  });

  it("creates a payment account", async () => {
    vi.mocked(findBusinessByOwnerId).mockResolvedValue({
      id: "biz_123",
      ownerId: "user_123",
      name: "Warung Test",
      currency: "IDR",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    vi.mocked(createPaymentAccountForBusiness).mockResolvedValue({
      id: "acct_non_cash",
      businessId: "biz_123",
      name: "Bank BCA",
      type: "non_cash",
      currentBalance: "0",
      isDefault: false,
      status: "active",
    } as never);

    const response = await request(app).post("/api/v1/payment-accounts").send({
      name: "Bank BCA",
    });

    expect(response.status).toBe(201);
    expect(createPaymentAccountForBusiness).toHaveBeenCalledWith("biz_123", "Bank BCA");
  });

  it("returns 409 when payment account already exists", async () => {
    vi.mocked(findBusinessByOwnerId).mockResolvedValue({
      id: "biz_123",
      ownerId: "user_123",
      name: "Warung Test",
      currency: "IDR",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    vi.mocked(createPaymentAccountForBusiness).mockRejectedValue(new PaymentAccountAlreadyExistsError());

    const response = await request(app).post("/api/v1/payment-accounts").send({
      name: "Bank BCA",
    });

    expect(response.status).toBe(409);
    expect(response.body.error.message).toBe("Payment account already exists.");
  });

  it("deactivates a non-cash payment account", async () => {
    vi.mocked(findBusinessByOwnerId).mockResolvedValue({
      id: "biz_123",
      ownerId: "user_123",
      name: "Warung Test",
      currency: "IDR",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    vi.mocked(deactivatePaymentAccountForBusiness).mockResolvedValue({
      id: "acct_non_cash",
      businessId: "biz_123",
      name: "Bank BCA",
      type: "non_cash",
      currentBalance: "0",
      isDefault: false,
      status: "inactive",
    } as never);

    const response = await request(app).delete("/api/v1/payment-accounts/acct_non_cash");

    expect(response.status).toBe(200);
    expect(deactivatePaymentAccountForBusiness).toHaveBeenCalledWith("biz_123", "acct_non_cash");
    expect(response.body.data.status).toBe("inactive");
  });

  it("returns 400 when trying to remove default cash account", async () => {
    vi.mocked(findBusinessByOwnerId).mockResolvedValue({
      id: "biz_123",
      ownerId: "user_123",
      name: "Warung Test",
      currency: "IDR",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    vi.mocked(deactivatePaymentAccountForBusiness).mockRejectedValue(new DefaultPaymentAccountRemovalError());

    const response = await request(app).delete("/api/v1/payment-accounts/acct_cash");

    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe("Default payment account cannot be removed.");
  });

  it("sets a payment account as default", async () => {
    vi.mocked(findBusinessByOwnerId).mockResolvedValue({
      id: "biz_123",
      ownerId: "user_123",
      name: "Warung Test",
      currency: "IDR",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    vi.mocked(setDefaultPaymentAccountForBusiness).mockResolvedValue({
      id: "acct_bank",
      businessId: "biz_123",
      name: "Bank BCA",
      type: "non_cash",
      currentBalance: "100000",
      isDefault: true,
      status: "active",
    } as never);

    const response = await request(app).patch("/api/v1/payment-accounts/acct_bank/default").send({});

    expect(response.status).toBe(200);
    expect(setDefaultPaymentAccountForBusiness).toHaveBeenCalledWith("biz_123", "acct_bank");
    expect(response.body.data.isDefault).toBe(true);
  });

  it("returns 404 when setting default on missing payment account", async () => {
    vi.mocked(findBusinessByOwnerId).mockResolvedValue({
      id: "biz_123",
      ownerId: "user_123",
      name: "Warung Test",
      currency: "IDR",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    vi.mocked(setDefaultPaymentAccountForBusiness).mockRejectedValue(new PaymentAccountNotFoundError());

    const response = await request(app).patch("/api/v1/payment-accounts/acct_missing/default").send({});

    expect(response.status).toBe(404);
    expect(response.body.error.message).toBe("Payment account not found.");
  });
});
