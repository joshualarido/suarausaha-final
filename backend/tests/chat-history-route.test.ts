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

vi.mock("../src/features/chat/chat-message.service.js", () => {
  return {
    listChatMessagesForBusinessUser: vi.fn(),
    toChatMessageResponse: vi.fn((message) => message),
  };
});

vi.mock("../src/features/confirmations/confirmation.service.js", () => {
  return {
    listPendingIntentConfirmations: vi.fn().mockResolvedValue([]),
  };
});

import { app } from "../src/app.js";
import { auth } from "../src/features/auth/auth.js";
import { findBusinessByOwnerId } from "../src/features/business/business.service.js";
import { listChatMessagesForBusinessUser } from "../src/features/chat/chat-message.service.js";

describe("chat history route", () => {
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

  it("returns chat thread for authenticated business owner", async () => {
    vi.mocked(listChatMessagesForBusinessUser).mockResolvedValue([
      {
        id: "msg_1",
        role: "user",
        kind: "text",
        contentJson: { text: "Jual ayam geprek 500 ribu tunai" },
      },
      {
        id: "msg_2",
        role: "assistant",
        kind: "confirmation_card",
        contentJson: { id: "confirm_1" },
      },
    ] as never);

    const response = await request(app).get("/api/v1/chat/thread");

    expect(response.status).toBe(200);
    expect(listChatMessagesForBusinessUser).toHaveBeenCalledWith({
      businessId: "biz_123",
      userId: "user_123",
      limit: 100,
    });
    expect(response.body.success).toBe(true);
    expect(response.body.data.messages).toHaveLength(2);
    expect(response.body.data.pendingConfirmationRequestId).toBe(null);
  });
});
