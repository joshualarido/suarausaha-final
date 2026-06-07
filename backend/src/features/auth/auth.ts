import { betterAuth } from "better-auth";
import { env } from "../../config/env.js";
import { db } from "../../lib/database.js";

const trustedOrigins = [
  env.API_BASE_URL,
  env.FRONTEND_ORIGIN,
  ...(env.NODE_ENV === "production" ? [] : ["http://127.0.0.1:5173"]),
];

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.API_BASE_URL,
  trustedOrigins,
  database: {
    db,
    type: "postgres",
  },
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
  },
});
