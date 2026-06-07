import { runFinancialWrite } from "../../lib/financial-write.js";
import { appendChatMessage } from "../chat/chat-message.service.js";
import { resolveSuraDateRange } from "./date-range.js";
import { runSuraAnalytics } from "./analytics.service.js";
import { formatSuraAnswer } from "./sura-answer-formatter.js";
import { classifySuraIntent, type SuraAnalyticsIntent } from "./sura-intent-classifier.js";
import { SURA_INPUT_GUIDE } from "./sura-input-guide.js";

export type SuraQueryResponseType =
  | "analytics_answer"
  | "write_action_redirect"
  | "report_request_redirect"
  | "help"
  | "unsupported";

export interface SuraQueryInput {
  businessId: string;
  userId: string;
  message: string;
}

export interface SuraQueryResponse {
  type: SuraQueryResponseType;
  intent: string;
  answer: string;
  data: Record<string, unknown>;
  warnings: string[];
}

async function persistSuraAnswer(input: SuraQueryInput & SuraQueryResponse): Promise<void> {
  await runFinancialWrite(async (tx) => {
    await appendChatMessage(tx, {
      businessId: input.businessId,
      userId: input.userId,
      role: "user",
      kind: "text",
      content: {
        text: input.message,
      },
    });

    await appendChatMessage(tx, {
      businessId: input.businessId,
      userId: input.userId,
      role: "assistant",
      kind: "system_result",
      content: {
        status: input.type,
        message: input.answer,
        data: input.data,
        warnings: input.warnings,
        intent: input.intent,
      },
    });
  });
}

function redirectResponse(type: "write_action_redirect" | "report_request_redirect", intent: string): SuraQueryResponse {
  if (type === "write_action_redirect") {
    return {
      type,
      intent,
      answer: "Saya akan teruskan ke alur pencatatan transaksi.",
      data: {
        redirectTo: "/api/v1/chat/parse",
      },
      warnings: [],
    };
  }

  return {
    type,
    intent,
    answer: "Saya akan teruskan ke alur laporan neraca.",
    data: {
      redirectTo: "/api/v1/chat/parse",
    },
    warnings: [],
  };
}

function helpResponse(): SuraQueryResponse {
  return {
    type: "help",
    intent: "help",
    answer:
      "Sura bisa bantu catat transaksi, tanya ringkasan usaha, dan buat neraca. Pakai kata kunci di bawah ini; data baru tetap hanya disimpan setelah kamu cek kartu konfirmasi.",
    data: {
      inputGuide: SURA_INPUT_GUIDE,
    },
    warnings: [],
  };
}

function unsupportedResponse(): SuraQueryResponse {
  return {
    type: "unsupported",
    intent: "unsupported",
    answer: "Maaf, Sura belum bisa menjawab pertanyaan itu. Coba tanya tentang kas, pemasukan, pengeluaran, utang, piutang, stok, aset, atau neraca.",
    data: {},
    warnings: [],
  };
}

function needsDateRange(intent: SuraAnalyticsIntent): boolean {
  return intent === "sales_total" || intent === "expense_total" || intent === "simple_net_income" || intent === "daily_summary";
}

export async function querySura(input: SuraQueryInput): Promise<SuraQueryResponse> {
  const classification = classifySuraIntent(input.message);

  if (classification.type === "write_action") {
    return redirectResponse("write_action_redirect", "write_action");
  }

  if (classification.type === "report_request") {
    return redirectResponse("report_request_redirect", "report_request");
  }

  if (classification.type === "help") {
    const response = helpResponse();
    await persistSuraAnswer({ ...input, ...response });
    return response;
  }

  if (classification.type !== "analytics_query" || !classification.analyticsIntent) {
    const response = unsupportedResponse();
    await persistSuraAnswer({ ...input, ...response });
    return response;
  }

  const resolvedDateRange = needsDateRange(classification.analyticsIntent)
    ? resolveSuraDateRange(classification.dateRange)
    : null;
  const data = await runSuraAnalytics({
    businessId: input.businessId,
    intent: classification.analyticsIntent,
    dateRange: resolvedDateRange,
    limit: classification.limit,
  });
  const formatted = formatSuraAnswer({
    intent: classification.analyticsIntent,
    dateLabel: resolvedDateRange?.label,
    result: data,
  });
  const response: SuraQueryResponse = {
    type: "analytics_answer",
    intent: classification.analyticsIntent,
    answer: formatted.answer,
    data,
    warnings: formatted.warnings,
  };

  await persistSuraAnswer({ ...input, ...response });
  return response;
}
