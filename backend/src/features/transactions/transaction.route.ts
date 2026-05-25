import { Router, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.middleware.js";
import { findBusinessByOwnerId } from "../business/business.service.js";
import {
  getAssetSummaryByBusinessId,
  getInventorySummaryByBusinessId,
  getLiabilitySummaryByBusinessId,
  getReceivableSummaryByBusinessId,
  listTransactionHistoryByBusinessId,
  TRANSACTION_TYPES,
} from "./transaction.service.js";

const transactionTypeSchema = z.enum(TRANSACTION_TYPES);

const transactionHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: transactionTypeSchema.optional(),
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  toDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

const transactionRouter = Router();

async function resolveBusinessOrRespond(userId: string, res: Response) {
  const business = await findBusinessByOwnerId(userId);

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

transactionRouter.get("/transactions", requireAuth, async (req, res) => {
  const parseResult = transactionHistoryQuerySchema.safeParse(req.query);
  if (!parseResult.success) {
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Query transaksi tidak valid.",
      },
    });
    return;
  }

  const business = await resolveBusinessOrRespond(req.user!.id, res);
  if (!business) return;

  const data = await listTransactionHistoryByBusinessId({
    businessId: business.id,
    ...parseResult.data,
  });

  res.json({
    success: true,
    data,
  });
});

transactionRouter.get("/inventory-summary", requireAuth, async (req, res) => {
  const business = await resolveBusinessOrRespond(req.user!.id, res);
  if (!business) return;

  const data = await getInventorySummaryByBusinessId(business.id);
  res.json({
    success: true,
    data,
  });
});

transactionRouter.get("/asset-summary", requireAuth, async (req, res) => {
  const business = await resolveBusinessOrRespond(req.user!.id, res);
  if (!business) return;

  const data = await getAssetSummaryByBusinessId(business.id);
  res.json({
    success: true,
    data,
  });
});

transactionRouter.get("/liabilities", requireAuth, async (req, res) => {
  const business = await resolveBusinessOrRespond(req.user!.id, res);
  if (!business) return;

  const data = await getLiabilitySummaryByBusinessId(business.id);
  res.json({
    success: true,
    data,
  });
});

transactionRouter.get("/receivables", requireAuth, async (req, res) => {
  const business = await resolveBusinessOrRespond(req.user!.id, res);
  if (!business) return;

  const data = await getReceivableSummaryByBusinessId(business.id);
  res.json({
    success: true,
    data,
  });
});

export { transactionRouter };
