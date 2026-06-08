import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  createBusinessForOwner,
  getBusinessOnboardingContextForOwner,
  markProductTourCompletedForOwner,
  resetBusinessForOwner,
  type BusinessOnboardingContext,
  updateBusinessNameForOwner,
} from "./business.service.js";

const createBusinessSchema = z.object({
  name: z.string().trim().min(1),
});

function toBusinessProfileResponse(context: BusinessOnboardingContext): {
  id: string;
  name: string;
  currency: string;
  hasCompletedOpeningBalance: boolean;
  hasCompletedProductTour: boolean;
  productTourCompletedAt: Date | null;
  onboardingStatus: "profile_created" | "opening_balance_pending" | "active";
  createdAt: Date;
} {
  const business = context.business!;

  return {
    id: business.id,
    name: business.name,
    currency: business.currency,
    hasCompletedOpeningBalance: context.hasCompletedOpeningBalance,
    hasCompletedProductTour: Boolean(business.productTourCompletedAt),
    productTourCompletedAt: business.productTourCompletedAt,
    onboardingStatus: context.onboardingStatus,
    createdAt: business.createdAt,
  };
}

const businessRouter = Router();

businessRouter.get("/business", requireAuth, async (req, res) => {
  const context = await getBusinessOnboardingContextForOwner(req.user!.id);

  if (!context.business) {
    res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Business profile not found.",
      },
    });
    return;
  }

  res.json({
    success: true,
    data: toBusinessProfileResponse(context),
  });
});

businessRouter.post("/business", requireAuth, async (req, res) => {
  const parseResult = createBusinessSchema.safeParse(req.body);

  if (!parseResult.success) {
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Business name is required.",
      },
    });
    return;
  }

  const existingBusinessContext = await getBusinessOnboardingContextForOwner(req.user!.id);

  if (existingBusinessContext.business) {
    res.status(409).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "MVP supports one business per user.",
      },
    });
    return;
  }

  const business = await createBusinessForOwner(req.user!.id, parseResult.data.name);
  const onboardingContext = await getBusinessOnboardingContextForOwner(req.user!.id);

  res.status(201).json({
    success: true,
    data: toBusinessProfileResponse({
      ...onboardingContext,
      business,
    }),
  });
});

businessRouter.patch("/business", requireAuth, async (req, res) => {
  const parseResult = createBusinessSchema.safeParse(req.body);

  if (!parseResult.success) {
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Business name is required.",
      },
    });
    return;
  }

  const updatedBusiness = await updateBusinessNameForOwner(req.user!.id, parseResult.data.name);

  if (!updatedBusiness) {
    res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Business profile not found.",
      },
    });
    return;
  }

  const onboardingContext = await getBusinessOnboardingContextForOwner(req.user!.id);

  res.json({
    success: true,
    data: toBusinessProfileResponse({
      ...onboardingContext,
      business: updatedBusiness,
    }),
  });
});

businessRouter.post("/business/product-tour/complete", requireAuth, async (req, res) => {
  const updatedBusiness = await markProductTourCompletedForOwner(req.user!.id);

  if (!updatedBusiness) {
    res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Business profile not found.",
      },
    });
    return;
  }

  res.json({
    success: true,
    data: {
      hasCompletedProductTour: Boolean(updatedBusiness.productTourCompletedAt),
      productTourCompletedAt: updatedBusiness.productTourCompletedAt,
    },
  });
});

businessRouter.post("/debug/reset-onboarding", requireAuth, async (req, res) => {
  if (env.NODE_ENV === "production") {
    res.status(403).json({
      success: false,
      error: {
        code: "FORBIDDEN",
        message: "Debug reset is not available in production.",
      },
    });
    return;
  }

  const didReset = await resetBusinessForOwner(req.user!.id);

  res.json({
    success: true,
    data: {
      reset: didReset,
    },
  });
});

export { businessRouter };
