import { z } from "zod";

import { proposedActionSchema } from "./parser.types.js";

export const supportedIntentSchema = proposedActionSchema.shape.intent;

export const geminiParserDraftSchema = z.object({
  detectedIntent: supportedIntentSchema.nullable(),
  amount: z.number().nullable(),
  date: z.string().nullable(),
  paymentAccountId: z.string().nullable(),
  paymentAccountName: z.string().nullable(),
  description: z.string().nullable(),
  affectedObject: z.string().nullable(),
  assumptions: z.array(z.string()).default([]),
  missingFields: z.array(z.string()).default([]),
  clarificationQuestion: z.string().nullable(),
  confidence: z.number().min(0).max(1).default(0),
  multipleEvents: z.boolean().default(false),
});

export type GeminiParserDraft = z.infer<typeof geminiParserDraftSchema>;

export const emptyGeminiParserDraft: GeminiParserDraft = {
  detectedIntent: null,
  amount: null,
  date: null,
  paymentAccountId: null,
  paymentAccountName: null,
  description: null,
  affectedObject: null,
  assumptions: [],
  missingFields: [],
  clarificationQuestion: null,
  confidence: 0,
  multipleEvents: false,
};
