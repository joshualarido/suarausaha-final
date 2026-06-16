import { describe, expect, it } from "vitest";

import { auth } from "../src/features/auth/auth.js";

describe("auth config", () => {
  it("stores OAuth state in a cookie for first-party proxied auth flows", () => {
    expect(auth.options.account?.storeStateStrategy).toBe("cookie");
  });
});
