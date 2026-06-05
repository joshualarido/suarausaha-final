import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.middleware.js";
import { findBusinessByOwnerId } from "../business/business.service.js";
import {
  confirmOpeningBalance,
  getConfirmedOpeningBalanceByBusinessId,
  OpeningBalanceAlreadyConfirmedError,
  previewOpeningBalance,
  toOpeningBalanceResponse,
} from "./opening-balance.service.js";

const aggregateOpeningBalancePayloadSchema = z.object({
  cashBalance: z.number().int().min(0),
  nonCashBalance: z.number().int().min(0).default(0),
  inventoryValue: z.number().int().min(0),
  assetValue: z.number().int().min(0),
  debtValue: z.number().int().min(0),
  receivableValue: z.number().int().min(0),
});

const itemizedOpeningBalancePayloadSchema = z
  .object({
    paymentAccounts: z
      .array(
        z.object({
          name: z.string().trim().min(1),
          type: z.enum(["cash", "non_cash"]),
          openingBalance: z.number().int().min(0),
        }),
      )
      .min(1),
    inventoryItems: z.array(z.object({ name: z.string().trim().optional(), value: z.number().int().min(0) })).max(1),
    assetItems: z.array(z.object({ name: z.string().trim().min(1), value: z.number().int().min(0) })),
    liabilityItems: z.array(z.object({ lenderName: z.string().trim().min(1), amount: z.number().int().min(0) })),
    receivableItems: z.array(z.object({ customerName: z.string().trim().min(1), amount: z.number().int().min(0) })),
  })
  .superRefine((value, ctx) => {
    const cashAccounts = value.paymentAccounts.filter((account) => account.type === "cash");
    if (cashAccounts.length !== 1 || cashAccounts[0]?.name !== "Kas") {
      ctx.addIssue({
        code: "custom",
        path: ["paymentAccounts"],
        message: "Opening balance must include exactly one cash account named Kas.",
      });
    }
  });

const openingBalancePayloadSchema = z.union([aggregateOpeningBalancePayloadSchema, itemizedOpeningBalancePayloadSchema]);

const openingBalanceRouter = Router();

openingBalanceRouter.get("/opening-balance", requireAuth, async (req, res) => {
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

  const openingBalance = await getConfirmedOpeningBalanceByBusinessId(business.id);

  if (!openingBalance) {
    res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Opening balance has not been confirmed.",
      },
    });
    return;
  }

  res.json({
    success: true,
    data: toOpeningBalanceResponse(openingBalance),
  });
});

openingBalanceRouter.post("/opening-balance/preview", requireAuth, async (req, res) => {
  const parseResult = openingBalancePayloadSchema.safeParse(req.body);

  if (!parseResult.success) {
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Opening balance values must be whole numbers and zero or greater.",
      },
    });
    return;
  }

  const preview = previewOpeningBalance(parseResult.data);

  res.json({
    success: true,
    data: {
      cashBalance: preview.cashBalance,
      nonCashBalance: preview.nonCashBalance,
      inventoryValue: preview.inventoryValue,
      assetValue: preview.assetValue,
      debtValue: preview.debtValue,
      receivableValue: preview.receivableValue,
      openingEquity: preview.openingEquity,
    },
  });
});

openingBalanceRouter.post("/opening-balance/confirm", requireAuth, async (req, res) => {
  const parseResult = openingBalancePayloadSchema.safeParse(req.body);

  if (!parseResult.success) {
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Opening balance values must be whole numbers and zero or greater.",
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
    const openingBalance = await confirmOpeningBalance(business.id, parseResult.data);

    res.status(201).json({
      success: true,
      data: {
        id: openingBalance.id,
        openingEquity: Number(openingBalance.openingEquity),
        confirmedAt: openingBalance.confirmedAt,
      },
    });
  } catch (error) {
    if (error instanceof OpeningBalanceAlreadyConfirmedError) {
      res.status(409).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Opening balance already confirmed for this business.",
        },
      });
      return;
    }

    throw error;
  }
});

export { openingBalanceRouter };
