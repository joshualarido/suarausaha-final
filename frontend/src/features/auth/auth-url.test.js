import assert from "node:assert/strict";
import test from "node:test";
import { resolveGoogleAuthUrls } from "./auth-url.js";

test("uses the auth API origin for Google OAuth while keeping the web origin as next", () => {
  const urls = resolveGoogleAuthUrls({
    apiBaseUrl: "https://suarausaha-web.onrender.com",
    authApiBaseUrl: "https://suarausaha-api.onrender.com",
    frontendOrigin: "https://suarausaha-web.onrender.com",
    callbackPath: "/onboarding/business",
  });

  assert.equal(
    urls.signInPath,
    "https://suarausaha-api.onrender.com/api/auth/sign-in/social?provider=google",
  );
  assert.equal(
    urls.callbackURL,
    "https://suarausaha-api.onrender.com/api/auth/session-handoff/start?next=https%3A%2F%2Fsuarausaha-web.onrender.com%2Fonboarding%2Fbusiness",
  );
});

test("falls back to the normal API base URL when no auth API origin is configured", () => {
  const urls = resolveGoogleAuthUrls({
    apiBaseUrl: "http://localhost:3000",
    authApiBaseUrl: "",
    frontendOrigin: "http://localhost:5173",
    callbackPath: "/onboarding/business",
  });

  assert.equal(
    urls.signInPath,
    "http://localhost:3000/api/auth/sign-in/social?provider=google",
  );
  assert.equal(
    urls.callbackURL,
    "http://localhost:3000/api/auth/session-handoff/start?next=http%3A%2F%2Flocalhost%3A5173%2Fonboarding%2Fbusiness",
  );
});
