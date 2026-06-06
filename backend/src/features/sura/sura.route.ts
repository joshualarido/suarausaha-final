import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.middleware.js";
import { findBusinessByOwnerId } from "../business/business.service.js";
import { querySura } from "./sura.service.js";

const suraRouter = Router();

const querySuraSchema = z.object({
  message: z.string().trim().min(1),
});

suraRouter.post("/sura/query", requireAuth, async (req, res) => {
  const parseResult = querySuraSchema.safeParse(req.body);

  if (!parseResult.success) {
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Pesan Sura wajib diisi.",
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

  const data = await querySura({
    businessId: business.id,
    userId: req.user!.id,
    message: parseResult.data.message,
  });

  res.json({
    success: true,
    data,
  });
});

export { suraRouter };
