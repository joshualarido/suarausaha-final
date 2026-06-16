import { randomBytes, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { makeSignature } from "better-auth/crypto";
import { fromNodeHeaders } from "better-auth/node";
import { db } from "../../lib/database.js";
import { env } from "../../config/env.js";
import { auth } from "./auth.js";

const HANDOFF_PREFIX = "auth-handoff:";
const HANDOFF_TTL_MS = 2 * 60 * 1000;
const SESSION_COOKIE_NAME = "__Secure-better-auth.session_token";
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

async function signCookieValue(value: string): Promise<string> {
  return `${value}.${await makeSignature(value, env.BETTER_AUTH_SECRET)}`;
}

function resolveSafeNext(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return `${env.FRONTEND_ORIGIN}/onboarding/business`;
  }

  const trimmed = value.trim();
  if (trimmed.startsWith("/")) {
    return `${env.FRONTEND_ORIGIN}${trimmed}`;
  }

  try {
    const url = new URL(trimmed);
    if (url.origin === env.FRONTEND_ORIGIN) {
      return url.toString();
    }
  } catch {
    // Fall through to the safe default.
  }

  return `${env.FRONTEND_ORIGIN}/onboarding/business`;
}

export async function startSessionHandoff(req: Request, res: Response): Promise<void> {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });

  if (!session?.session?.token) {
    res.redirect(302, `${env.FRONTEND_ORIGIN}/login`);
    return;
  }

  const token = randomBytes(32).toString("base64url");
  await db
    .insertInto("verification")
    .values({
      id: randomUUID(),
      identifier: `${HANDOFF_PREFIX}${token}`,
      value: session.session.token,
      expiresAt: new Date(Date.now() + HANDOFF_TTL_MS),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .execute();

  const next = encodeURIComponent(resolveSafeNext(req.query.next));
  res.redirect(302, `${env.FRONTEND_ORIGIN}/api/auth/session-handoff/claim?token=${token}&next=${next}`);
}

export async function claimSessionHandoff(req: Request, res: Response): Promise<void> {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const next = resolveSafeNext(req.query.next);

  if (!token) {
    res.redirect(302, `${env.FRONTEND_ORIGIN}/login`);
    return;
  }

  const identifier = `${HANDOFF_PREFIX}${token}`;
  const handoff = await db
    .selectFrom("verification")
    .select(["value", "expiresAt"])
    .where("identifier", "=", identifier)
    .executeTakeFirst();

  await db.deleteFrom("verification").where("identifier", "=", identifier).execute();

  if (!handoff || handoff.expiresAt.getTime() < Date.now()) {
    res.redirect(302, `${env.FRONTEND_ORIGIN}/login`);
    return;
  }

  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=${await signCookieValue(handoff.value)}; Max-Age=${SESSION_MAX_AGE_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Lax`,
  );
  res.redirect(302, next);
}
