import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/features/auth/auth.js", () => {
  return {
    auth: {
      api: {
        getSession: vi.fn(),
      },
    },
  };
});

vi.mock("../src/features/business/business.service.js", () => {
  return {
    findBusinessByOwnerId: vi.fn(),
    getBusinessOnboardingContextForOwner: vi.fn(),
    createBusinessForOwner: vi.fn(),
    resetBusinessForOwner: vi.fn(),
    updateBusinessNameForOwner: vi.fn(),
  };
});

vi.mock("../src/features/menu-items/menu-item.service.js", () => {
  class MenuItemAlreadyExistsError extends Error {
    constructor() {
      super("Menu item already exists.");
    }
  }

  class MenuItemNotFoundError extends Error {
    constructor() {
      super("Menu item not found for this business.");
    }
  }

  return {
    listActiveMenuItemsByBusinessId: vi.fn(),
    createMenuItemForBusiness: vi.fn(),
    updateMenuItemForBusiness: vi.fn(),
    deactivateMenuItemForBusiness: vi.fn(),
    MenuItemAlreadyExistsError,
    MenuItemNotFoundError,
  };
});

import { app } from "../src/app.js";
import { auth } from "../src/features/auth/auth.js";
import { findBusinessByOwnerId } from "../src/features/business/business.service.js";
import {
  createMenuItemForBusiness,
  deactivateMenuItemForBusiness,
  listActiveMenuItemsByBusinessId,
  MenuItemAlreadyExistsError,
  MenuItemNotFoundError,
  updateMenuItemForBusiness,
} from "../src/features/menu-items/menu-item.service.js";

const business = {
  id: "biz_123",
  ownerId: "user_123",
  name: "Warung Test",
  currency: "IDR",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const ayamGeprek = {
  id: "menu_ayam_geprek",
  businessId: "biz_123",
  name: "Ayam Geprek",
  aliases: ["geprek"],
  defaultPrice: "15000",
  category: "Makanan",
  status: "active",
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("menu item routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: {
        id: "user_123",
        name: "Josh",
        email: "josh@example.com",
      },
      session: {
        id: "session_123",
        userId: "user_123",
        expiresAt: new Date(),
      },
    } as never);
    vi.mocked(findBusinessByOwnerId).mockResolvedValue(business as never);
  });

  it("returns active menu items for the authenticated business", async () => {
    vi.mocked(listActiveMenuItemsByBusinessId).mockResolvedValue([ayamGeprek] as never);

    const response = await request(app).get("/api/v1/menu-items");

    expect(response.status).toBe(200);
    expect(listActiveMenuItemsByBusinessId).toHaveBeenCalledWith("biz_123");
    expect(response.body.data).toEqual([
      {
        id: "menu_ayam_geprek",
        name: "Ayam Geprek",
        aliases: ["geprek"],
        defaultPrice: 15_000,
        category: "Makanan",
        status: "active",
      },
    ]);
  });

  it("rejects menu item creation without a name", async () => {
    const response = await request(app).post("/api/v1/menu-items").send({
      name: "   ",
      defaultPrice: 15_000,
    });

    expect(response.status).toBe(400);
    expect(createMenuItemForBusiness).not.toHaveBeenCalled();
  });

  it("creates a menu item without trusting client businessId", async () => {
    vi.mocked(createMenuItemForBusiness).mockResolvedValue(ayamGeprek as never);

    const response = await request(app).post("/api/v1/menu-items").send({
      businessId: "malicious_business",
      name: "Ayam Geprek",
      aliases: ["geprek"],
      defaultPrice: 15_000,
      category: "Makanan",
    });

    expect(response.status).toBe(201);
    expect(createMenuItemForBusiness).toHaveBeenCalledWith("biz_123", {
      name: "Ayam Geprek",
      aliases: ["geprek"],
      defaultPrice: 15_000,
      category: "Makanan",
    });
  });

  it("returns 409 when an active menu item already exists", async () => {
    vi.mocked(createMenuItemForBusiness).mockRejectedValue(new MenuItemAlreadyExistsError());

    const response = await request(app).post("/api/v1/menu-items").send({
      name: "Ayam Geprek",
    });

    expect(response.status).toBe(409);
    expect(response.body.error.message).toBe("Menu item already exists.");
  });

  it("updates a menu item for the authenticated business", async () => {
    vi.mocked(updateMenuItemForBusiness).mockResolvedValue({
      ...ayamGeprek,
      name: "Ayam Geprek Pedas",
      aliases: ["geprek pedas"],
      defaultPrice: "17000",
    } as never);

    const response = await request(app).patch("/api/v1/menu-items/menu_ayam_geprek").send({
      name: "Ayam Geprek Pedas",
      aliases: ["geprek pedas"],
      defaultPrice: 17_000,
      category: "Makanan",
    });

    expect(response.status).toBe(200);
    expect(updateMenuItemForBusiness).toHaveBeenCalledWith("biz_123", "menu_ayam_geprek", {
      name: "Ayam Geprek Pedas",
      aliases: ["geprek pedas"],
      defaultPrice: 17_000,
      category: "Makanan",
    });
    expect(response.body.data.defaultPrice).toBe(17_000);
  });

  it("returns 404 when updating another business menu item", async () => {
    vi.mocked(updateMenuItemForBusiness).mockRejectedValue(new MenuItemNotFoundError());

    const response = await request(app).patch("/api/v1/menu-items/menu_missing").send({
      name: "Menu Baru",
    });

    expect(response.status).toBe(404);
    expect(response.body.error.message).toBe("Menu item not found.");
  });

  it("archives a menu item instead of hard deleting it", async () => {
    vi.mocked(deactivateMenuItemForBusiness).mockResolvedValue({
      ...ayamGeprek,
      status: "inactive",
    } as never);

    const response = await request(app).delete("/api/v1/menu-items/menu_ayam_geprek");

    expect(response.status).toBe(200);
    expect(deactivateMenuItemForBusiness).toHaveBeenCalledWith("biz_123", "menu_ayam_geprek");
    expect(response.body.data.status).toBe("inactive");
  });

  it("returns 404 when the authenticated user has no business", async () => {
    vi.mocked(findBusinessByOwnerId).mockResolvedValue(null as never);

    const response = await request(app).get("/api/v1/menu-items");

    expect(response.status).toBe(404);
    expect(listActiveMenuItemsByBusinessId).not.toHaveBeenCalled();
  });
});
