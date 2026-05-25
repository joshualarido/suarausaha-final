import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.middleware.js";
import { findBusinessByOwnerId } from "../business/business.service.js";
import {
  createMenuItemForBusiness,
  deactivateMenuItemForBusiness,
  listActiveMenuItemsByBusinessId,
  MenuItemAlreadyExistsError,
  MenuItemNotFoundError,
  updateMenuItemForBusiness,
  type MenuItem,
} from "./menu-item.service.js";

const menuItemRouter = Router();

const menuItemWriteSchema = z.object({
  name: z.string().trim().min(1),
  aliases: z.array(z.string().trim().min(1)).default([]),
  defaultPrice: z.number().int().positive().nullable().optional(),
  category: z.string().trim().min(1).nullable().optional(),
});

function getParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] : (value ?? "");
}

function normalizeWriteInput(input: z.infer<typeof menuItemWriteSchema>) {
  return {
    name: input.name,
    aliases: input.aliases,
    defaultPrice: input.defaultPrice ?? null,
    category: input.category ?? null,
  };
}

function parseAliases(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  }

  return [];
}

function toMenuItemResponse(menuItem: MenuItem) {
  return {
    id: menuItem.id,
    name: menuItem.name,
    aliases: parseAliases(menuItem.aliases),
    defaultPrice: menuItem.defaultPrice === null ? null : Number(menuItem.defaultPrice),
    category: menuItem.category,
    status: menuItem.status,
  };
}

async function getOwnedBusinessOrRespond(req: Request, res: Response) {
  const business = await findBusinessByOwnerId(req.user!.id);

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

menuItemRouter.get("/menu-items", requireAuth, async (req, res) => {
  const business = await getOwnedBusinessOrRespond(req, res);
  if (!business) return;

  const menuItems = await listActiveMenuItemsByBusinessId(business.id);
  res.json({
    success: true,
    data: menuItems.map(toMenuItemResponse),
  });
});

menuItemRouter.post("/menu-items", requireAuth, async (req, res) => {
  const parseResult = menuItemWriteSchema.safeParse(req.body);

  if (!parseResult.success) {
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Nama menu wajib diisi.",
      },
    });
    return;
  }

  const business = await getOwnedBusinessOrRespond(req, res);
  if (!business) return;

  try {
    const created = await createMenuItemForBusiness(business.id, normalizeWriteInput(parseResult.data));
    res.status(201).json({
      success: true,
      data: toMenuItemResponse(created),
    });
  } catch (error) {
    if (error instanceof MenuItemAlreadyExistsError) {
      res.status(409).json({
        success: false,
        error: {
          code: "ALREADY_EXISTS",
          message: "Menu item already exists.",
        },
      });
      return;
    }

    throw error;
  }
});

menuItemRouter.patch("/menu-items/:menuItemId", requireAuth, async (req, res) => {
  const parseResult = menuItemWriteSchema.safeParse(req.body);

  if (!parseResult.success) {
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Nama menu wajib diisi.",
      },
    });
    return;
  }

  const business = await getOwnedBusinessOrRespond(req, res);
  if (!business) return;

  try {
    const updated = await updateMenuItemForBusiness(
      business.id,
      getParam(req.params.menuItemId),
      normalizeWriteInput(parseResult.data),
    );
    res.json({
      success: true,
      data: toMenuItemResponse(updated),
    });
  } catch (error) {
    if (error instanceof MenuItemNotFoundError) {
      res.status(404).json({
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "Menu item not found.",
        },
      });
      return;
    }

    if (error instanceof MenuItemAlreadyExistsError) {
      res.status(409).json({
        success: false,
        error: {
          code: "ALREADY_EXISTS",
          message: "Menu item already exists.",
        },
      });
      return;
    }

    throw error;
  }
});

menuItemRouter.delete("/menu-items/:menuItemId", requireAuth, async (req, res) => {
  const business = await getOwnedBusinessOrRespond(req, res);
  if (!business) return;

  try {
    const removed = await deactivateMenuItemForBusiness(business.id, getParam(req.params.menuItemId));
    res.json({
      success: true,
      data: toMenuItemResponse(removed),
    });
  } catch (error) {
    if (error instanceof MenuItemNotFoundError) {
      res.status(404).json({
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "Menu item not found.",
        },
      });
      return;
    }

    throw error;
  }
});

export { menuItemRouter };
