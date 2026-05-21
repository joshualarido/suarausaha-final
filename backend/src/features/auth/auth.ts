import { betterAuth } from "better-auth";
import { env } from "../../config/env.js";
import { db } from "../../lib/database.js";

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.API_BASE_URL,
  trustedOrigins: [env.API_BASE_URL, env.FRONTEND_ORIGIN, "http://127.0.0.1:5173"],
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
