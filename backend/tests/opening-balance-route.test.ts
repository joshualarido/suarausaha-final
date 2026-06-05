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

vi.mock("../src/features/opening-balance/opening-balance.service.js", () => {
  class OpeningBalanceAlreadyConfirmedError extends Error {
    constructor() {
      super("Opening balance already confirmed for this business.");
    }
  }

  return {
    confirmOpeningBalance: vi.fn(),
    getConfirmedOpeningBalanceByBusinessId: vi.fn(),
    previewOpeningBalance: vi.fn(),
    toOpeningBalanceResponse: vi.fn(),
    OpeningBalanceAlreadyConfirmedError,
  };
});

import { app } from "../src/app.js";
import { auth } from "../src/features/auth/auth.js";
import { findBusinessByOwnerId } from "../src/features/business/business.service.js";
import {
  confirmOpeningBalance,
  getConfirmedOpeningBalanceByBusinessId,
  OpeningBalanceAlreadyConfirmedError,
  previewOpeningBalance,
  toOpeningBalanceResponse,
} from "../src/features/opening-balance/opening-balance.service.js";

describe("opening balance routes", () => {
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

  it("returns opening balance preview", async () => {
    vi.mocked(previewOpeningBalance).mockReturnValue({
      cashBalance: 500_000,
      nonCashBalance: 0,
      inventoryValue: 300_000,
      assetValue: 2_000_000,
      debtValue: 400_000,
      receivableValue: 150_000,
      openingAssets: 2_950_000,
      openingLiabilities: 400_000,
      openingEquity: 2_550_000,
    });

    const response = await request(app).post("/api/v1/opening-balance/preview").send({
      cashBalance: 500_000,
      inventoryValue: 300_000,
      assetValue: 2_000_000,
      debtValue: 400_000,
      receivableValue: 150_000,
    });

    expect(response.status).toBe(200);
    expect(previewOpeningBalance).toHaveBeenCalledWith({
      cashBalance: 500_000,
      nonCashBalance: 0,
      inventoryValue: 300_000,
      assetValue: 2_000_000,
      debtValue: 400_000,
      receivableValue: 150_000,
    });
    expect(confirmOpeningBalance).not.toHaveBeenCalled();
    expect(findBusinessByOwnerId).not.toHaveBeenCalled();
    expect(response.body.data.openingEquity).toBe(2_550_000);
  });

  it("returns opening balance preview from itemized rows", async () => {
    vi.mocked(previewOpeningBalance).mockReturnValue({
      cashBalance: 1_000_000,
      nonCashBalance: 500_000,
      inventoryValue: 300_000,
      assetValue: 2_000_000,
      debtValue: 700_000,
      receivableValue: 200_000,
      openingAssets: 4_000_000,
      openingLiabilities: 700_000,
      openingEquity: 3_300_000,
    });

    const response = await request(app).post("/api/v1/opening-balance/preview").send({
      paymentAccounts: [
        { name: "Kas", type: "cash", openingBalance: 1_000_000 },
        { name: "Bank BCA", type: "non_cash", openingBalance: 300_000 },
        { name: "QRIS", type: "non_cash", openingBalance: 200_000 },
      ],
      inventoryItems: [{ value: 300_000 }],
      assetItems: [{ name: "Peralatan awal", value: 2_000_000 }],
      liabilityItems: [{ lenderName: "Supplier ayam", amount: 700_000 }],
      receivableItems: [{ customerName: "Budi", amount: 200_000 }],
    });

    expect(response.status).toBe(200);
    expect(previewOpeningBalance).toHaveBeenCalledWith({
      paymentAccounts: [
        { name: "Kas", type: "cash", openingBalance: 1_000_000 },
        { name: "Bank BCA", type: "non_cash", openingBalance: 300_000 },
        { name: "QRIS", type: "non_cash", openingBalance: 200_000 },
      ],
      inventoryItems: [{ value: 300_000 }],
      assetItems: [{ name: "Peralatan awal", value: 2_000_000 }],
      liabilityItems: [{ lenderName: "Supplier ayam", amount: 700_000 }],
      receivableItems: [{ customerName: "Budi", amount: 200_000 }],
    });
    expect(response.body.data.openingEquity).toBe(3_300_000);
  });

  it("rejects itemized opening balance rows with missing names", async () => {
    const response = await request(app).post("/api/v1/opening-balance/preview").send({
      paymentAccounts: [{ name: "Kas", type: "cash", openingBalance: 1_000_000 }],
      inventoryItems: [{ value: 300_000 }],
      assetItems: [{ name: "", value: 2_000_000 }],
      liabilityItems: [],
      receivableItems: [],
    });

    expect(response.status).toBe(400);
    expect(previewOpeningBalance).not.toHaveBeenCalled();
  });

  it("rejects multiple opening inventory estimate rows", async () => {
    const response = await request(app).post("/api/v1/opening-balance/preview").send({
      paymentAccounts: [{ name: "Kas", type: "cash", openingBalance: 1_000_000 }],
      inventoryItems: [
        { value: 300_000 },
        { value: 100_000 },
      ],
      assetItems: [],
      liabilityItems: [],
      receivableItems: [],
    });

    expect(response.status).toBe(400);
    expect(previewOpeningBalance).not.toHaveBeenCalled();
  });

  it("confirms opening balance once", async () => {
    vi.mocked(findBusinessByOwnerId).mockResolvedValue({
      id: "biz_123",
      ownerId: "user_123",
      name: "Warung Test",
      currency: "IDR",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    vi.mocked(confirmOpeningBalance).mockResolvedValue({
      id: "opening_123",
      openingEquity: "3550000",
      confirmedAt: new Date("2026-05-12T10:00:00Z"),
    } as never);

    const response = await request(app).post("/api/v1/opening-balance/confirm").send({
      cashBalance: 500_000,
      nonCashBalance: 1_000_000,
      inventoryValue: 300_000,
      assetValue: 2_000_000,
      debtValue: 400_000,
      receivableValue: 150_000,
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        id: "opening_123",
        openingEquity: 3_550_000,
      },
    });
  });

  it("confirms itemized opening balance once", async () => {
    vi.mocked(findBusinessByOwnerId).mockResolvedValue({
      id: "biz_123",
      ownerId: "user_123",
      name: "Warung Test",
      currency: "IDR",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    vi.mocked(confirmOpeningBalance).mockResolvedValue({
      id: "opening_123",
      openingEquity: "3300000",
      confirmedAt: new Date("2026-05-12T10:00:00Z"),
    } as never);

    const payload = {
      paymentAccounts: [
        { name: "Kas", type: "cash", openingBalance: 1_000_000 },
        { name: "Bank BCA", type: "non_cash", openingBalance: 500_000 },
      ],
      inventoryItems: [{ value: 300_000 }],
      assetItems: [{ name: "Peralatan awal", value: 2_000_000 }],
      liabilityItems: [{ lenderName: "Supplier ayam", amount: 700_000 }],
      receivableItems: [{ customerName: "Budi", amount: 200_000 }],
    };

    const response = await request(app).post("/api/v1/opening-balance/confirm").send(payload);

    expect(response.status).toBe(201);
    expect(confirmOpeningBalance).toHaveBeenCalledWith("biz_123", payload);
    expect(response.body.data.openingEquity).toBe(3_300_000);
  });

  it("rejects reconfirming opening balance", async () => {
    vi.mocked(findBusinessByOwnerId).mockResolvedValue({
      id: "biz_123",
      ownerId: "user_123",
      name: "Warung Test",
      currency: "IDR",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    vi.mocked(confirmOpeningBalance).mockRejectedValue(new OpeningBalanceAlreadyConfirmedError());

    const response = await request(app).post("/api/v1/opening-balance/confirm").send({
      cashBalance: 500_000,
      nonCashBalance: 1_000_000,
      inventoryValue: 300_000,
      assetValue: 2_000_000,
      debtValue: 400_000,
      receivableValue: 150_000,
    });

    expect(response.status).toBe(409);
    expect(response.body.error.message).toBe("Opening balance already confirmed for this business.");
  });

  it("returns confirmed opening balance", async () => {
    vi.mocked(findBusinessByOwnerId).mockResolvedValue({
      id: "biz_123",
      ownerId: "user_123",
      name: "Warung Test",
      currency: "IDR",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    vi.mocked(getConfirmedOpeningBalanceByBusinessId).mockResolvedValue({
      id: "opening_123",
    } as never);

    vi.mocked(toOpeningBalanceResponse).mockReturnValue({
      id: "opening_123",
      cashBalance: 500_000,
      nonCashBalance: 1_000_000,
      inventoryValue: 300_000,
      assetValue: 2_000_000,
      debtValue: 400_000,
      receivableValue: 150_000,
      openingEquity: 3_550_000,
      confirmedAt: new Date("2026-05-12T10:00:00Z"),
    });

    const response = await request(app).get("/api/v1/opening-balance");

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe("opening_123");
  });
});
