import { describe, expect, it } from "vitest";

import { auth } from "../src/features/auth/auth.js";

describe("auth config", () => {
  it("keeps Google OAuth callback on the API origin registered with Google", () => {
    expect(auth.options.baseURL).toBe("http://localhost:3000");
  });
});
