import request from "supertest";
import { describe, expect, it } from "vitest";

import { app } from "../src/app.js";

describe("root route", () => {
  it("redirects API root visits back to the frontend app", async () => {
    const response = await request(app).get("/");

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("http://localhost:5173");
  });
});
