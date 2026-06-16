function trimTrailingSlash(value) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function normalizeOrigin(value) {
  return typeof value === "string" && value.trim() ? trimTrailingSlash(value.trim()) : "";
}

export function resolveAuthApiBaseUrl(authApiBaseUrl, apiBaseUrl) {
  return normalizeOrigin(authApiBaseUrl) || normalizeOrigin(apiBaseUrl);
}

export function resolveGoogleAuthUrls({
  apiBaseUrl,
  authApiBaseUrl,
  frontendOrigin,
  callbackPath,
}) {
  const authBaseUrl = resolveAuthApiBaseUrl(authApiBaseUrl, apiBaseUrl);
  const webOrigin = normalizeOrigin(frontendOrigin);

  if (!authBaseUrl) {
    throw new Error("Alamat API login belum dikonfigurasi.");
  }

  if (!webOrigin) {
    throw new Error("Alamat web aplikasi belum dikonfigurasi.");
  }

  const next = `${webOrigin}${callbackPath}`;
  return {
    signInPath: `${authBaseUrl}/api/auth/sign-in/social?provider=google`,
    callbackURL: `${authBaseUrl}/api/auth/session-handoff/start?next=${encodeURIComponent(next)}`,
  };
}
