import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.middleware.js";
import { findBusinessByOwnerId } from "../business/business.service.js";
import {
  createNeracaReport,
  getNeracaReportForBusiness,
  listNeracaReports,
  NeracaReportNotFoundError,
  OpeningBalanceRequiredError,
  previewNeraca,
  renderNeracaPdf,
} from "./neraca.service.js";

const neracaRouter = Router();

const reportDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const previewQuerySchema = z.object({
  reportDate: reportDateSchema.optional(),
});
const createNeracaSchema = z.object({
  reportDate: reportDateSchema.optional(),
});
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function getParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] : (value ?? "");
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

function handleNeracaError(error: unknown, res: Response): boolean {
  if (error instanceof OpeningBalanceRequiredError) {
    res.status(409).json({
      success: false,
      error: {
        code: "OPENING_BALANCE_REQUIRED",
        message: error.message,
      },
    });
    return true;
  }

  if (error instanceof NeracaReportNotFoundError) {
    res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: error.message,
      },
    });
    return true;
  }

  return false;
}

async function previewHandler(req: Request, res: Response): Promise<void> {
  const parseResult = previewQuerySchema.safeParse(req.query);
  if (!parseResult.success) {
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Tanggal laporan tidak valid.",
      },
    });
    return;
  }

  const business = await resolveBusinessOrRespond(req.user!.id, res);
  if (!business) return;

  try {
    const data = await previewNeraca({
      businessId: business.id,
      userId: req.user!.id,
      generatedByName: req.user!.name,
      reportDate: parseResult.data.reportDate ?? todayIso(),
    });

    res.json({ success: true, data });
  } catch (error) {
    if (!handleNeracaError(error, res)) throw error;
  }
}

async function previewBodyHandler(req: Request, res: Response): Promise<void> {
  const parseResult = createNeracaSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Tanggal laporan tidak valid.",
      },
    });
    return;
  }

  req.query = { ...req.query, reportDate: parseResult.data.reportDate };
  await previewHandler(req, res);
}

async function createSnapshotHandler(req: Request, res: Response): Promise<void> {
  const parseResult = createNeracaSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Tanggal laporan tidak valid.",
      },
    });
    return;
  }

  const business = await resolveBusinessOrRespond(req.user!.id, res);
  if (!business) return;

  try {
    const data = await createNeracaReport({
      businessId: business.id,
      userId: req.user!.id,
      generatedByName: req.user!.name,
      reportDate: parseResult.data.reportDate ?? todayIso(),
    });

    res.status(201).json({
      success: true,
      data: {
        ...data,
        message: "Laporan neraca berhasil disimpan.",
      },
    });
  } catch (error) {
    if (!handleNeracaError(error, res)) throw error;
  }
}

async function listSnapshotsHandler(req: Request, res: Response): Promise<void> {
  const parseResult = listQuerySchema.safeParse(req.query);
  if (!parseResult.success) {
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Query laporan neraca tidak valid.",
      },
    });
    return;
  }

  const business = await resolveBusinessOrRespond(req.user!.id, res);
  if (!business) return;

  const data = await listNeracaReports({
    businessId: business.id,
    page: parseResult.data.page,
    limit: parseResult.data.limit,
  });

  res.json({ success: true, data });
}

neracaRouter.get("/neraca/preview", requireAuth, previewHandler);
neracaRouter.post("/neraca/preview", requireAuth, previewBodyHandler);
neracaRouter.post("/neraca", requireAuth, createSnapshotHandler);
neracaRouter.post("/neraca/snapshots", requireAuth, createSnapshotHandler);
neracaRouter.get("/neraca", requireAuth, listSnapshotsHandler);
neracaRouter.get("/neraca/snapshots", requireAuth, listSnapshotsHandler);

async function getSnapshotForRequest(req: { user?: { id: string }; params: Record<string, string | string[] | undefined> }, res: Response) {
  const business = await resolveBusinessOrRespond(req.user!.id, res);
  if (!business) return null;

  return getNeracaReportForBusiness({
    businessId: business.id,
    neracaReportId: getParam(req.params.neracaReportId ?? req.params.snapshotId ?? req.params.id),
  });
}

neracaRouter.get("/neraca/:neracaReportId/pdf", requireAuth, async (req, res) => {
  try {
    const report = await getSnapshotForRequest(req, res);
    if (!report) return;
    const pdf = renderNeracaPdf(report);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="neraca-${report.reportDate}.pdf"`);
    res.send(pdf);
  } catch (error) {
    if (!handleNeracaError(error, res)) throw error;
  }
});

neracaRouter.get("/neraca/snapshots/:snapshotId/pdf", requireAuth, async (req, res) => {
  try {
    const report = await getSnapshotForRequest(req, res);
    if (!report) return;
    const pdf = renderNeracaPdf(report);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="neraca-${report.reportDate}.pdf"`);
    res.send(pdf);
  } catch (error) {
    if (!handleNeracaError(error, res)) throw error;
  }
});

neracaRouter.get("/neraca/:neracaReportId", requireAuth, async (req, res) => {
  try {
    const data = await getSnapshotForRequest(req, res);
    if (!data) return;
    res.json({ success: true, data });
  } catch (error) {
    if (!handleNeracaError(error, res)) throw error;
  }
});

neracaRouter.get("/neraca/snapshots/:snapshotId", requireAuth, async (req, res) => {
  try {
    const data = await getSnapshotForRequest(req, res);
    if (!data) return;
    res.json({ success: true, data });
  } catch (error) {
    if (!handleNeracaError(error, res)) throw error;
  }
});

export { neracaRouter };
