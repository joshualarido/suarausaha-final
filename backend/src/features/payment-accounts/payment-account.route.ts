import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.middleware.js";
import { findBusinessByOwnerId } from "../business/business.service.js";
import {
  createPaymentAccountForBusiness,
  DefaultPaymentAccountRemovalError,
  deactivatePaymentAccountForBusiness,
  ensureDefaultPaymentAccountsForBusinessId,
  listPaymentAccountsByBusinessId,
  PaymentAccountAlreadyExistsError,
  PaymentAccountNotFoundError,
  setDefaultPaymentAccountForBusiness,
  updatePaymentAccountNameForBusiness,
} from "./payment-account.service.js";

const paymentAccountRouter = Router();
const updatePaymentAccountNameSchema = z.object({
  name: z.string().trim().min(1),
});
const createPaymentAccountSchema = z.object({
  name: z.string().trim().min(1),
});

function getParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] : (value ?? "");
}

paymentAccountRouter.get("/payment-accounts", requireAuth, async (req, res) => {
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

  let accounts = await listPaymentAccountsByBusinessId(business.id);
  const hasCashAccount = accounts.some((account) => account.type === "cash");

  if (!hasCashAccount) {
    await ensureDefaultPaymentAccountsForBusinessId(business.id);
    accounts = await listPaymentAccountsByBusinessId(business.id);
  }

  res.json({
    success: true,
    data: accounts.map((account) => ({
      id: account.id,
      name: account.name,
      currentBalance: Number(account.currentBalance),
      isDefault: account.isDefault,
      status: account.status,
    })),
  });
});

paymentAccountRouter.patch("/payment-accounts/:paymentAccountId", requireAuth, async (req, res) => {
  const parseResult = updatePaymentAccountNameSchema.safeParse(req.body);

  if (!parseResult.success) {
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Payment account name is required.",
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

  try {
    const updated = await updatePaymentAccountNameForBusiness(
      business.id,
      getParam(req.params.paymentAccountId),
      parseResult.data.name,
    );

    res.json({
      success: true,
      data: {
        id: updated.id,
        name: updated.name,
        currentBalance: Number(updated.currentBalance),
        isDefault: updated.isDefault,
        status: updated.status,
      },
    });
  } catch (error) {
    if (error instanceof PaymentAccountNotFoundError) {
      res.status(404).json({
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "Payment account not found.",
        },
      });
      return;
    }

    throw error;
  }
});

paymentAccountRouter.post("/payment-accounts", requireAuth, async (req, res) => {
  const parseResult = createPaymentAccountSchema.safeParse(req.body);

  if (!parseResult.success) {
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Payment account name is required.",
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

  try {
    const created = await createPaymentAccountForBusiness(business.id, parseResult.data.name);

    res.status(201).json({
      success: true,
      data: {
        id: created.id,
        name: created.name,
        currentBalance: Number(created.currentBalance),
        isDefault: created.isDefault,
        status: created.status,
      },
    });
  } catch (error) {
    if (error instanceof PaymentAccountAlreadyExistsError) {
      res.status(409).json({
        success: false,
        error: {
          code: "ALREADY_EXISTS",
          message: "Payment account already exists.",
        },
      });
      return;
    }

    throw error;
  }
});

paymentAccountRouter.delete("/payment-accounts/:paymentAccountId", requireAuth, async (req, res) => {
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

  try {
    const removed = await deactivatePaymentAccountForBusiness(business.id, getParam(req.params.paymentAccountId));
    res.json({
      success: true,
      data: {
        id: removed.id,
        name: removed.name,
        currentBalance: Number(removed.currentBalance),
        isDefault: removed.isDefault,
        status: removed.status,
      },
    });
  } catch (error) {
    if (error instanceof PaymentAccountNotFoundError) {
      res.status(404).json({
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "Payment account not found.",
        },
      });
      return;
    }

    if (error instanceof DefaultPaymentAccountRemovalError) {
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Default payment account cannot be removed.",
        },
      });
      return;
    }

    throw error;
  }
});

paymentAccountRouter.patch("/payment-accounts/:paymentAccountId/default", requireAuth, async (req, res) => {
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

  try {
    const updated = await setDefaultPaymentAccountForBusiness(business.id, getParam(req.params.paymentAccountId));
    res.json({
      success: true,
      data: {
        id: updated.id,
        name: updated.name,
        currentBalance: Number(updated.currentBalance),
        isDefault: updated.isDefault,
        status: updated.status,
      },
    });
  } catch (error) {
    if (error instanceof PaymentAccountNotFoundError) {
      res.status(404).json({
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "Payment account not found.",
        },
      });
      return;
    }

    throw error;
  }
});

export { paymentAccountRouter };
