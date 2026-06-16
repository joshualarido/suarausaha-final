import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const blueprint = readFileSync(resolve(process.cwd(), "../render.yaml"), "utf8");

describe("Render Blueprint", () => {
  it("routes frontend API requests through the web origin before the SPA fallback", () => {
    const apiRewriteIndex = blueprint.indexOf("source: /api/*");
    const spaFallbackIndex = blueprint.indexOf("source: /*");

    expect(apiRewriteIndex).toBeGreaterThan(-1);
    expect(spaFallbackIndex).toBeGreaterThan(-1);
    expect(apiRewriteIndex).toBeLessThan(spaFallbackIndex);
    expect(blueprint).toContain("API_BASE_URL\n        value: https://suarausaha-api.onrender.com");
    expect(blueprint).toContain("destination: https://suarausaha-api.onrender.com/api/*");
    expect(blueprint).toContain("VITE_API_BASE_URL\n        value: https://suarausaha-web.onrender.com");
    expect(blueprint).toContain("VITE_AUTH_API_BASE_URL\n        value: https://suarausaha-api.onrender.com");
  });
});
