import { randomUUID } from "node:crypto";
import { db, type BusinessRow } from "../../lib/database.js";
import { runFinancialWrite } from "../../lib/financial-write.js";
import { getConfirmedOpeningBalanceByBusinessId } from "../opening-balance/opening-balance.service.js";
import { ensureDefaultPaymentAccounts } from "../payment-accounts/payment-account.service.js";

export type OnboardingStatus = "profile_created" | "opening_balance_pending" | "active";

export interface BusinessOnboardingContext {
  business: BusinessRow | null;
  hasBusiness: boolean;
  hasCompletedOpeningBalance: boolean;
  onboardingStatus: OnboardingStatus;
}

export function resolveOnboardingStatus(
  hasBusiness: boolean,
  hasCompletedOpeningBalance: boolean,
): OnboardingStatus {
  if (!hasBusiness) {
    return "profile_created";
  }

  return hasCompletedOpeningBalance ? "active" : "opening_balance_pending";
}

export async function findBusinessByOwnerId(ownerId: string): Promise<BusinessRow | null> {
  const business = await db
    .selectFrom("business")
    .selectAll()
    .where("ownerId", "=", ownerId)
    .executeTakeFirst();

  return business ?? null;
}

export async function createBusinessForOwner(ownerId: string, name: string): Promise<BusinessRow> {
  return runFinancialWrite(async (tx) => {
    const now = new Date();
    const id = randomUUID();

    const created = await tx
      .insertInto("business")
      .values({
        id,
        ownerId,
        name,
        currency: "IDR",
        productTourCompletedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await ensureDefaultPaymentAccounts(tx, { businessId: created.id });

    return created;
  });
}

export async function updateBusinessNameForOwner(ownerId: string, name: string): Promise<BusinessRow | null> {

  const existingBusiness = await findBusinessByOwnerId(ownerId);

  if (!existingBusiness) {
    return null;
  }

  const updated = await db
    .updateTable("business")
    .set({
      name,
      updatedAt: new Date(),
    })
    .where("id", "=", existingBusiness.id)
    .returningAll()
    .executeTakeFirst();

  return updated ?? null;
}

export async function markProductTourCompletedForOwner(ownerId: string): Promise<BusinessRow | null> {
  const existingBusiness = await findBusinessByOwnerId(ownerId);

  if (!existingBusiness) {
    return null;
  }

  const completedAt = existingBusiness.productTourCompletedAt ?? new Date();
  const updated = await db
    .updateTable("business")
    .set({
      productTourCompletedAt: completedAt,
      updatedAt: new Date(),
    })
    .where("id", "=", existingBusiness.id)
    .returningAll()
    .executeTakeFirst();

  return updated ?? null;
}

export async function resetBusinessForOwner(ownerId: string): Promise<boolean> {
  return runFinancialWrite(async (tx) => {
    const existingBusiness = await tx
      .selectFrom("business")
      .select("id")
      .where("ownerId", "=", ownerId)
      .executeTakeFirst();

    if (!existingBusiness) {
      return false;
    }

    await tx.deleteFrom("business").where("id", "=", existingBusiness.id).executeTakeFirst();
    return true;
  });
}

export async function getBusinessOnboardingContextForOwner(ownerId: string): Promise<BusinessOnboardingContext> {
  const business = await findBusinessByOwnerId(ownerId);

  if (!business) {
    return {
      business: null,
      hasBusiness: false,
      hasCompletedOpeningBalance: false,
      onboardingStatus: resolveOnboardingStatus(false, false),
    };
  }

  const openingBalance = await getConfirmedOpeningBalanceByBusinessId(business.id);
  const hasCompletedOpeningBalance = Boolean(openingBalance);

  return {
    business,
    hasBusiness: true,
    hasCompletedOpeningBalance,
    onboardingStatus: resolveOnboardingStatus(true, hasCompletedOpeningBalance),
  };
}
