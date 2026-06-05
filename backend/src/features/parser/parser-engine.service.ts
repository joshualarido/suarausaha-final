import { env } from "../../config/env.js";
import { deterministicIntentParser } from "./deterministic-parser.service.js";
import {
  emptyGeminiParserDraft,
  type GeminiParserDraft,
} from "./gemini-parser.types.js";
import {
  GeminiParserUnavailableError,
  geminiDraftParser,
  type GeminiDraftParser,
} from "./gemini-parser.adapter.js";
import { intentOptions } from "./intent-catalog.js";
import type { IntentParser, ParseIntentInput, ParseIntentResult } from "./parser.types.js";
import { validateParserDraft } from "./parser-validator.service.js";
import { createInventoryOrExpenseClarification } from "./ambiguity.service.js";

function safeClarificationResult(
  input: ParseIntentInput,
  draft: GeminiParserDraft,
  validationErrors: string[],
): ParseIntentResult {
  return {
    status: "needs_clarification",
    proposedAction: null,
    missingFields: ["parser"],
    validationErrors,
    question: "Aku belum bisa membaca transaksi ini dengan aman. Transaksi ini mau dicatat sebagai apa?",
    options: intentOptions,
    confidence: draft.confidence,
    parserModel: env.GEMINI_MODEL,
    parserVersion: "gemini-engine-v1",
    structuredPayload: {
      ...draft,
      rawInputText: input.message,
    },
  };
}

export function createParserEngine(draftParser: GeminiDraftParser = geminiDraftParser): IntentParser {
  return {
    async parse(input) {
      if (!input.clarification) {
        const ambiguityResult = createInventoryOrExpenseClarification(input);
        if (ambiguityResult) return ambiguityResult;
      }

      if (env.PARSER_ENGINE === "deterministic") {
        return deterministicIntentParser.parse(input);
      }

      try {
        const draft = await draftParser.parseDraft(input);
        return validateParserDraft(input, draft, env.GEMINI_MODEL);
      } catch (error) {
        const message =
          error instanceof GeminiParserUnavailableError || error instanceof Error
            ? error.message
            : "Gemini parser failed.";

        return safeClarificationResult(input, emptyGeminiParserDraft, [message]);
      }
    },
  };
}

export const parserEngine = createParserEngine();
