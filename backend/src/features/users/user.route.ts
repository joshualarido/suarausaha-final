import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.middleware.js";
import { getBusinessOnboardingContextForOwner } from "../business/business.service.js";
import { db } from "../../lib/database.js";

const userRouter = Router();
const updateUserProfileSchema = z.object({
  name: z.string().trim().min(1),
});

userRouter.get("/me", requireAuth, async (req, res) => {
  const context = await getBusinessOnboardingContextForOwner(req.user!.id);

  res.json({
    success: true,
    data: {
      id: req.user!.id,
      name: req.user!.name,
      email: req.user!.email,
      hasBusiness: context.hasBusiness,
      businessId: context.business?.id ?? null,
      onboardingStatus: context.onboardingStatus,
    },
  });
});

userRouter.patch("/me", requireAuth, async (req, res) => {
  const parseResult = updateUserProfileSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Nama pengguna wajib diisi.",
      },
    });
    return;
  }

  const updated = await db
    .updateTable("user")
    .set({
      name: parseResult.data.name,
      updatedAt: new Date(),
    })
    .where("id", "=", req.user!.id)
    .returning(["id", "name", "email"])
    .executeTakeFirst();

  if (!updated) {
    res.status(404).json({
      success: false,
      error: {
        code: "USER_NOT_FOUND",
        message: "Pengguna tidak ditemukan.",
      },
    });
    return;
  }

  const context = await getBusinessOnboardingContextForOwner(req.user!.id);

  res.json({
    success: true,
    data: {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      hasBusiness: context.hasBusiness,
      businessId: context.business?.id ?? null,
      onboardingStatus: context.onboardingStatus,
    },
  });
});

export { userRouter };
