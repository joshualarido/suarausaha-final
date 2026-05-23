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

vi.mock("../src/features/chat/chat.service.js", () => {
  return {
    parseChatMessage: vi.fn(),
    clarifyChatMessage: vi.fn(),
  };
});

vi.mock("../src/features/chat/chat-message.service.js", () => {
  return {
    appendChatMessage: vi.fn(),
    listChatMessagesForBusinessUser: vi.fn(),
    toChatMessageResponse: vi.fn((message) => message),
  };
});

vi.mock("../src/features/confirmations/confirmation.service.js", () => {
  class ConfirmationNotFoundError extends Error {}
  class InvalidConfirmationStateError extends Error {}

  return {
    getConfirmationRequestForUser: vi.fn(),
    confirmConfirmationRequest: vi.fn(),
    cancelConfirmationRequest: vi.fn(),
    editConfirmationRequest: vi.fn(),
    toConfirmationResponse: vi.fn((confirmation) => confirmation),
    ConfirmationNotFoundError,
    InvalidConfirmationStateError,
  };
});

import { app } from "../src/app.js";
import { auth } from "../src/features/auth/auth.js";
import { findBusinessByOwnerId } from "../src/features/business/business.service.js";
import { parseChatMessage } from "../src/features/chat/chat.service.js";
import { confirmConfirmationRequest } from "../src/features/confirmations/confirmation.service.js";

describe("chat and confirmation routes", () => {
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

  it("requires authentication before parsing chat text", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);

    const response = await request(app).post("/api/v1/chat/parse").send({
      message: "jual ayam geprek 500 ribu tunai",
    });

    expect(response.status).toBe(401);
    expect(parseChatMessage).not.toHaveBeenCalled();
  });

  it("uses the logged-in user's business when parsing", async () => {
    vi.mocked(parseChatMessage).mockResolvedValue({
      status: "requires_confirmation",
      confirmationRequestId: "confirm_123",
      proposedAction: {
        intent: "sales_income",
        amount: 500_000,
        date: "2026-05-23",
        paymentAccountId: "acct_cash",
        description: "Jual ayam geprek tunai",
        expectedEffects: ["Kas bertambah Rp500.000"],
      },
    } as never);

    const response = await request(app).post("/api/v1/chat/parse").send({
      message: "jual ayam geprek 500 ribu tunai",
      businessId: "malicious_business",
    });

    expect(response.status).toBe(200);
    expect(parseChatMessage).toHaveBeenCalledWith({
      businessId: "biz_123",
      userId: "user_123",
      message: "jual ayam geprek 500 ribu tunai",
    });
  });

  it("confirms through the authenticated user and business context", async () => {
    vi.mocked(confirmConfirmationRequest).mockResolvedValue({
      transactionId: "txn_123",
      message: "Transaksi berhasil disimpan.",
    });

    const response = await request(app).post("/api/v1/confirmations/confirm_123/confirm").send({});

    expect(response.status).toBe(200);
    expect(confirmConfirmationRequest).toHaveBeenCalledWith({
      businessId: "biz_123",
      userId: "user_123",
      confirmationRequestId: "confirm_123",
    });
  });
});
