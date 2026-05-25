import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.middleware.js";
import { findBusinessByOwnerId } from "../business/business.service.js";
import { clearChatThreadForBusinessUser, listChatMessagesForBusinessUser, toChatMessageResponse } from "./chat-message.service.js";
import { clarifyChatMessage, parseChatMessage } from "./chat.service.js";
import { listPendingIntentConfirmations } from "../confirmations/confirmation.service.js";

const parseChatSchema = z.object({
  message: z.string().trim().min(1),
});

const clarifyChatSchema = z.object({
  clarificationId: z.string().trim().min(1),
  answer: z.string().trim().min(1),
});

const chatRouter = Router();

chatRouter.post("/chat/parse", requireAuth, async (req, res) => {
  const parseResult = parseChatSchema.safeParse(req.body);

  if (!parseResult.success) {
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Pesan transaksi wajib diisi.",
      },
    });
    return;
  }

  const business = await findBusinessByOwnerId(req.user!.id);

  if (!business) {
    res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Business profile not found.",
      },
    });
    return;
  }

  const data = await parseChatMessage({
    businessId: business.id,
    userId: req.user!.id,
    message: parseResult.data.message,
  });

  res.json({
    success: true,
    data,
  });
});

chatRouter.post("/chat/clarify", requireAuth, async (req, res) => {
  const parseResult = clarifyChatSchema.safeParse(req.body);

  if (!parseResult.success) {
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Jawaban klarifikasi wajib diisi.",
      },
    });
    return;
  }

  const business = await findBusinessByOwnerId(req.user!.id);

  if (!business) {
    res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Business profile not found.",
      },
    });
    return;
  }

  const data = await clarifyChatMessage({
    businessId: business.id,
    userId: req.user!.id,
    clarificationId: parseResult.data.clarificationId,
    answer: parseResult.data.answer,
  });

  res.json({
    success: true,
    data,
  });
});

chatRouter.get("/chat/thread", requireAuth, async (req, res) => {
  const business = await findBusinessByOwnerId(req.user!.id);

  if (!business) {
    res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Business profile not found.",
      },
    });
    return;
  }

  const messages = await listChatMessagesForBusinessUser({
    businessId: business.id,
    userId: req.user!.id,
    limit: 100,
  });
  const [latestPending] = await listPendingIntentConfirmations({
    businessId: business.id,
    userId: req.user!.id,
    limit: 1,
  });

  res.json({
    success: true,
    data: {
      messages: messages.map(toChatMessageResponse),
      pendingConfirmationRequestId: latestPending?.id ?? null,
    },
  });
});

chatRouter.delete("/chat/thread", requireAuth, async (req, res) => {
  const business = await findBusinessByOwnerId(req.user!.id);

  if (!business) {
    res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Business profile not found.",
      },
    });
    return;
  }

  await clearChatThreadForBusinessUser({
    businessId: business.id,
    userId: req.user!.id,
  });

  res.json({
    success: true,
    data: {
      message: "Riwayat chat berhasil dibersihkan.",
    },
  });
});

export { chatRouter };
