import { Router, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.middleware.js";
import { findBusinessByOwnerId } from "../business/business.service.js";
import { getOverviewByBusinessId } from "./overview.service.js";

const overviewRouter = Router();

const overviewQuerySchema = z.object({
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  toDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDefaultMonthRange() {
  const now = new Date();
  return {
    fromDate: toDateInputValue(new Date(now.getFullYear(), now.getMonth(), 1)),
    toDate: toDateInputValue(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

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

overviewRouter.get("/overview", requireAuth, async (req, res) => {
  const parseResult = overviewQuerySchema.safeParse(req.query);
  if (!parseResult.success) {
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Query overview tidak valid.",
      },
    });
    return;
  }

  const business = await resolveBusinessOrRespond(req.user!.id, res);
  if (!business) return;

  const defaults = getDefaultMonthRange();
  const data = await getOverviewByBusinessId({
    businessId: business.id,
    userId: req.user!.id,
    fromDate: parseResult.data.fromDate ?? defaults.fromDate,
    toDate: parseResult.data.toDate ?? defaults.toDate,
  });

  res.json({
    success: true,
    data,
  });
});

export { overviewRouter };
