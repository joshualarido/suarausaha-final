import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/financial-write.js", () => {
  return {
    runFinancialWrite: vi.fn(async (callback) => callback({})),
  };
});

vi.mock("../src/features/chat/chat-message.service.js", () => {
  return {
    appendChatMessage: vi.fn(),
  };
});

vi.mock("../src/features/sura/analytics.service.js", () => {
  return {
    runSuraAnalytics: vi.fn(),
  };
});

import { querySura } from "../src/features/sura/sura.service.js";
import { classifySuraIntent } from "../src/features/sura/sura-intent-classifier.js";

type GuideSection = {
  title: string;
  items: Array<{
    label: string;
    keywords: string[];
    example: string;
    routeType: "write_action" | "report_request" | "analytics_query" | "pending_sales_edit";
  }>;
};

function flattenGuide(inputGuide: unknown) {
  expect(Array.isArray(inputGuide)).toBe(true);
  return (inputGuide as GuideSection[]).flatMap((section) => section.items);
}

describe("Sura help input guide", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a concise input guide when the user asks for help", async () => {
    const result = await querySura({
      businessId: "biz_123",
      userId: "user_123",
      message: "bantuan",
    });

    expect(result).toMatchObject({
      type: "help",
      intent: "help",
    });
    expect(result.answer).toContain("kartu konfirmasi");

    const guideItems = flattenGuide(result.data.inputGuide);
    expect(guideItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Penjualan",
          keywords: ["jual", "terjual"],
          example: "jual 2 ayam geprek tunai",
          routeType: "write_action",
        }),
        expect.objectContaining({
          label: "Neraca",
          keywords: ["neraca", "laporan neraca"],
          example: "buat neraca bulan ini",
          routeType: "report_request",
        }),
        expect.objectContaining({
          label: "Tanya data",
          keywords: ["kas", "pemasukan", "pengeluaran", "laba", "utang", "piutang", "stok", "aset"],
          example: "berapa kas sekarang",
          routeType: "analytics_query",
        }),
      ]),
    );
  });

  it("keeps normal guide examples aligned with the top-level Sura classifier", async () => {
    const result = await querySura({
      businessId: "biz_123",
      userId: "user_123",
      message: "cara pakai",
    });

    const guideItems = flattenGuide(result.data.inputGuide);
    for (const item of guideItems) {
      if (item.routeType === "pending_sales_edit") continue;

      expect(classifySuraIntent(item.example)).toMatchObject({
        type: item.routeType,
      });
    }
  });

  it("does not expose parser engine names in user-facing help data", async () => {
    const result = await querySura({
      businessId: "biz_123",
      userId: "user_123",
      message: "Sura bisa apa?",
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/gemini/i);
    expect(serialized).not.toMatch(/deterministic/i);
    expect(serialized).not.toContain("PARSER_ENGINE");
  });
});
