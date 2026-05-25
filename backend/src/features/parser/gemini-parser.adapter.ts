import { GoogleGenAI, Type } from "@google/genai";

import { env } from "../../config/env.js";
import type { ParseIntentInput } from "./parser.types.js";
import {
  emptyGeminiParserDraft,
  geminiParserDraftSchema,
  type GeminiParserDraft,
} from "./gemini-parser.types.js";
import { intentCodes, SUPPORTED_INTENT_CATALOG } from "./intent-catalog.js";

const parserResponseSchema = {
  type: Type.OBJECT,
  properties: {
    detectedIntent: {
      type: Type.STRING,
      nullable: true,
      enum: [
        "sales_income",
        "general_expense",
        "inventory_purchase_value",
        "asset_record_or_purchase",
        "liability_created",
        "liability_payment",
        "receivable_created",
        "receivable_payment",
        "owner_capital_contribution",
        "owner_withdrawal",
        "reversal",
      ],
    },
    amount: { type: Type.NUMBER, nullable: true },
    date: { type: Type.STRING, nullable: true },
    paymentAccountId: { type: Type.STRING, nullable: true },
    paymentAccountName: { type: Type.STRING, nullable: true },
    description: { type: Type.STRING, nullable: true },
    affectedObject: { type: Type.STRING, nullable: true },
    assumptions: { type: Type.ARRAY, items: { type: Type.STRING } },
    missingFields: { type: Type.ARRAY, items: { type: Type.STRING } },
    clarificationQuestion: { type: Type.STRING, nullable: true },
    confidence: { type: Type.NUMBER },
    multipleEvents: { type: Type.BOOLEAN },
  },
  required: [
    "detectedIntent",
    "amount",
    "date",
    "paymentAccountId",
    "paymentAccountName",
    "description",
    "affectedObject",
    "assumptions",
    "missingFields",
    "clarificationQuestion",
    "confidence",
    "multipleEvents",
  ],
};

function buildPrompt(input: ParseIntentInput): string {
  const payload = {
    task: "Parse one Indonesian MSME bookkeeping chat message into a draft transaction payload.",
    safetyRules: [
      "Return JSON only.",
      "Only propose one business event. If the message contains multiple events, set multipleEvents true.",
      "Do not invent missing financial values.",
      "Use null for unknown fields.",
      "Amounts must be IDR integer values, not formatted strings.",
        "If the transaction type is reasonably clear, choose exactly one supported detectedIntent.",
        "If the transaction type is unclear, set detectedIntent null, include missingFields ['intent'], and ask the user to choose a supported intent.",
        "If required data is missing for a clear intent, keep detectedIntent and ask only for the missing detail.",
        "Menu prices may be used only for clear sales with a positive quantity and one exact active menu match.",
        "The backend will validate everything before confirmation.",
      ],
    allowedIntents: intentCodes,
    intentCatalog: SUPPORTED_INTENT_CATALOG,
    clarificationRules: [
      "If the transaction type is unclear, ask: Transaksi ini paling cocok dicatat sebagai apa?",
      "If the intent is clear but amount is missing, ask: Berapa nominalnya?",
      "If the payment account is missing or ambiguous, ask which payment account was used.",
      "If there are multiple business events, ask the user to enter one transaction at a time.",
      "Clarification questions must use simple Indonesian business language and should not mention debit or credit.",
    ],
    today: input.today,
    paymentAccounts: input.paymentAccounts,
    defaultPaymentAccount: {
      id: input.defaultPaymentAccountId,
      name: input.defaultPaymentAccountName,
    },
    menuItems: input.menuItems,
    openLiabilities: input.openLiabilities ?? [],
    openReceivables: input.openReceivables ?? [],
    message: input.message,
    clarification: input.clarification ?? null,
  };

  return JSON.stringify(payload);
}

export { buildPrompt };

export class GeminiParserUnavailableError extends Error {
  constructor(message = "Gemini parser is not configured.") {
    super(message);
  }
}

export interface GeminiDraftParser {
  parseDraft(input: ParseIntentInput): Promise<GeminiParserDraft>;
}

export function createGeminiDraftParser(): GeminiDraftParser {
  return {
    async parseDraft(input) {
      if (!env.GEMINI_API_KEY) {
        throw new GeminiParserUnavailableError();
      }

      const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: env.GEMINI_MODEL,
        contents: buildPrompt(input),
        config: {
          responseMimeType: "application/json",
          responseSchema: parserResponseSchema,
          temperature: 0.1,
        },
      });

      const text = response.text;
      if (!text) {
        return emptyGeminiParserDraft;
      }

      return geminiParserDraftSchema.parse(JSON.parse(text));
    },
  };
}

export const geminiDraftParser = createGeminiDraftParser();
