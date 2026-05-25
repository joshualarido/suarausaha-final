import { randomUUID } from "node:crypto";
import type { Selectable } from "kysely";
import { db, type MenuItemRow } from "../../lib/database.js";
import { runFinancialWrite } from "../../lib/financial-write.js";

export type MenuItem = Selectable<MenuItemRow>;

export interface MenuItemWriteInput {
  name: string;
  aliases: string[];
  defaultPrice: number | null;
  category: string | null;
}

export class MenuItemNotFoundError extends Error {
  constructor() {
    super("Menu item not found for this business.");
  }
}

export class MenuItemAlreadyExistsError extends Error {
  constructor() {
    super("Menu item already exists.");
  }
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeAliases(aliases: string[]): string[] {
  return [...new Set(aliases.map(normalizeName).filter(Boolean))];
}

function toStoredPrice(defaultPrice: number | null): string | null {
  return defaultPrice === null ? null : Math.round(defaultPrice).toString();
}

export async function listActiveMenuItemsByBusinessId(businessId: string): Promise<MenuItem[]> {
  return db
    .selectFrom("menu_items")
    .selectAll()
    .where("businessId", "=", businessId)
    .where("status", "=", "active")
    .orderBy("createdAt", "asc")
    .execute();
}

export async function createMenuItemForBusiness(
  businessId: string,
  input: MenuItemWriteInput,
): Promise<MenuItem> {
  return runFinancialWrite(async (tx) => {
    const normalizedName = normalizeName(input.name);
    const existing = await tx
      .selectFrom("menu_items")
      .selectAll()
      .where("businessId", "=", businessId)
      .execute();

    const existingMatch = existing.find((item) => normalizeName(item.name) === normalizedName);
    const now = new Date();
    const aliases = normalizeAliases(input.aliases);

    if (existingMatch) {
      if (existingMatch.status === "active") {
        throw new MenuItemAlreadyExistsError();
      }

      return tx
        .updateTable("menu_items")
        .set({
          name: input.name,
          aliases: JSON.stringify(aliases),
          defaultPrice: toStoredPrice(input.defaultPrice),
          category: input.category,
          status: "active",
          updatedAt: now,
        })
        .where("id", "=", existingMatch.id)
        .where("businessId", "=", businessId)
        .returningAll()
        .executeTakeFirstOrThrow();
    }

    return tx
      .insertInto("menu_items")
      .values({
        id: randomUUID(),
        businessId,
        name: input.name,
        aliases: JSON.stringify(aliases),
        defaultPrice: toStoredPrice(input.defaultPrice),
        category: input.category,
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  });
}

export async function updateMenuItemForBusiness(
  businessId: string,
  menuItemId: string,
  input: MenuItemWriteInput,
): Promise<MenuItem> {
  return runFinancialWrite(async (tx) => {
    const existing = await tx
      .selectFrom("menu_items")
      .selectAll()
      .where("id", "=", menuItemId)
      .where("businessId", "=", businessId)
      .where("status", "=", "active")
      .executeTakeFirst();

    if (!existing) {
      throw new MenuItemNotFoundError();
    }

    const normalizedName = normalizeName(input.name);
    const duplicates = await tx
      .selectFrom("menu_items")
      .select(["id", "name", "status"])
      .where("businessId", "=", businessId)
      .where("status", "=", "active")
      .execute();

    const duplicate = duplicates.find((item) => item.id !== menuItemId && normalizeName(item.name) === normalizedName);
    if (duplicate) {
      throw new MenuItemAlreadyExistsError();
    }

    return tx
      .updateTable("menu_items")
      .set({
        name: input.name,
        aliases: JSON.stringify(normalizeAliases(input.aliases)),
        defaultPrice: toStoredPrice(input.defaultPrice),
        category: input.category,
        updatedAt: new Date(),
      })
      .where("id", "=", menuItemId)
      .where("businessId", "=", businessId)
      .returningAll()
      .executeTakeFirstOrThrow();
  });
}

export async function deactivateMenuItemForBusiness(businessId: string, menuItemId: string): Promise<MenuItem> {
  return runFinancialWrite(async (tx) => {
    const existing = await tx
      .selectFrom("menu_items")
      .selectAll()
      .where("id", "=", menuItemId)
      .where("businessId", "=", businessId)
      .where("status", "=", "active")
      .executeTakeFirst();

    if (!existing) {
      throw new MenuItemNotFoundError();
    }

    return tx
      .updateTable("menu_items")
      .set({
        status: "inactive",
        updatedAt: new Date(),
      })
      .where("id", "=", menuItemId)
      .where("businessId", "=", businessId)
      .returningAll()
      .executeTakeFirstOrThrow();
  });
}
