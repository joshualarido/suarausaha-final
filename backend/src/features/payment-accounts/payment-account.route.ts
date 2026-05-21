import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import { findBusinessByOwnerId } from "../business/business.service.js";
import {
  ensureDefaultPaymentAccountsForBusinessId,
  listPaymentAccountsByBusinessId,
} from "./payment-account.service.js";

const paymentAccountRouter = Router();

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
  const hasNonCashAccount = accounts.some((account) => account.type === "non_cash");

  if (!hasCashAccount || !hasNonCashAccount) {
    await ensureDefaultPaymentAccountsForBusinessId(business.id);
    accounts = await listPaymentAccountsByBusinessId(business.id);
  }

  res.json({
    success: true,
    data: accounts.map((account) => ({
      id: account.id,
      name: account.name,
      type: account.type,
      currentBalance: Number(account.currentBalance),
      isDefault: account.isDefault,
      status: account.status,
    })),
  });
});

export { paymentAccountRouter };
