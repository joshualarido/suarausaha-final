import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import { getBusinessOnboardingContextForOwner } from "../business/business.service.js";

const userRouter = Router();

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

export { userRouter };
