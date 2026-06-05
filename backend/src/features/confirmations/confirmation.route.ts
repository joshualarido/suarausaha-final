import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.middleware.js";
import { findBusinessByOwnerId } from "../business/business.service.js";
import {
  cancelConfirmationRequest,
  confirmConfirmationRequest,
  ConfirmationNotFoundError,
  editConfirmationRequest,
  getConfirmationRequestForUser,
  InvalidConfirmationStateError,
  toConfirmationResponse,
} from "./confirmation.service.js";
import { runFinancialWrite } from "../../lib/financial-write.js";
import { appendChatMessage } from "../chat/chat-message.service.js";

const editConfirmationSchema = z.object({
  amount: z.number().int().positive().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  paymentAccountId: z.string().min(1).nullable().optional(),
  paymentAccountName: z.string().min(1).nullable().optional(),
  description: z.string().trim().min(1).optional(),
});

const confirmationRouter = Router();

async function resolveBusiness(req: Request, res: Response) {
  const business = await findBusinessByOwnerId(req.user!.id);

  if (!business) {
    res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Business profile not found.",
      },
    });
    return null;
  }

  return business;
}

function handleConfirmationError(error: unknown, res: Response): boolean {
  if (error instanceof ConfirmationNotFoundError) {
    res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Confirmation request not found.",
      },
    });
    return true;
  }

  if (error instanceof InvalidConfirmationStateError) {
    const errorCode = error.code ?? "CONFIRMATION_NOT_USABLE";
    res.status(409).json({
      success: false,
      error: {
        code: errorCode,
        message: error.message,
      },
    });
    return true;
  }

  return false;
}

function getParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] : (value ?? "");
}

confirmationRouter.get("/confirmations/:confirmationRequestId", requireAuth, async (req, res) => {
  const business = await resolveBusiness(req, res);
  if (!business) return;

  try {
    const confirmation = await getConfirmationRequestForUser({
      businessId: business.id,
      userId: req.user!.id,
      confirmationRequestId: getParam(req.params.confirmationRequestId),
    });

    res.json({
      success: true,
      data: toConfirmationResponse(confirmation),
    });
  } catch (error) {
    if (!handleConfirmationError(error, res)) throw error;
  }
});

confirmationRouter.post("/confirmations/:confirmationRequestId/confirm", requireAuth, async (req, res) => {
  const business = await resolveBusiness(req, res);
  if (!business) return;

  try {
    const data = await confirmConfirmationRequest({
      businessId: business.id,
      userId: req.user!.id,
      confirmationRequestId: getParam(req.params.confirmationRequestId),
    });

    await runFinancialWrite(async (tx) => {
      await appendChatMessage(tx, {
        businessId: business.id,
        userId: req.user!.id,
        role: "assistant",
        kind: "system_result",
        confirmationRequestId: getParam(req.params.confirmationRequestId),
        transactionId: data.transactionId ?? null,
        content: {
          message: data.message,
          type: data.type,
          transactionId: data.transactionId,
          neracaReportId: data.neracaReportId,
        },
      });
    });

    res.json({
      success: true,
      data,
    });
  } catch (error) {
    if (!handleConfirmationError(error, res)) throw error;
  }
});

confirmationRouter.post("/confirmations/:confirmationRequestId/cancel", requireAuth, async (req, res) => {
  const business = await resolveBusiness(req, res);
  if (!business) return;

  try {
    const confirmation = await cancelConfirmationRequest({
      businessId: business.id,
      userId: req.user!.id,
      confirmationRequestId: getParam(req.params.confirmationRequestId),
    });

    await runFinancialWrite(async (tx) => {
      await appendChatMessage(tx, {
        businessId: business.id,
        userId: req.user!.id,
        role: "assistant",
        kind: "system_result",
        confirmationRequestId: confirmation.id,
        content: {
          message: "Oke, transaksi tidak disimpan.",
          status: "cancelled",
        },
      });
    });

    res.json({
      success: true,
      data: toConfirmationResponse(confirmation),
    });
  } catch (error) {
    if (!handleConfirmationError(error, res)) throw error;
  }
});

confirmationRouter.patch("/confirmations/:confirmationRequestId", requireAuth, async (req, res) => {
  const parseResult = editConfirmationSchema.safeParse(req.body);

  if (!parseResult.success) {
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Data edit konfirmasi tidak valid.",
      },
    });
    return;
  }

  const business = await resolveBusiness(req, res);
  if (!business) return;

  try {
    const confirmation = await editConfirmationRequest({
      businessId: business.id,
      userId: req.user!.id,
      confirmationRequestId: getParam(req.params.confirmationRequestId),
      patch: parseResult.data,
    });

    await runFinancialWrite(async (tx) => {
      await appendChatMessage(tx, {
        businessId: business.id,
        userId: req.user!.id,
        role: "assistant",
        kind: "confirmation_card",
        confirmationRequestId: confirmation.id,
        parsedCommandId: confirmation.parsedCommandId,
        content: {
          status: "requires_confirmation",
          confirmationRequestId: confirmation.id,
          confirmation: toConfirmationResponse(confirmation),
          proposedAction: confirmation.proposedActionJson,
        },
      });
    });

    res.json({
      success: true,
      data: toConfirmationResponse(confirmation),
    });
  } catch (error) {
    if (!handleConfirmationError(error, res)) throw error;
  }
});

export { confirmationRouter };
