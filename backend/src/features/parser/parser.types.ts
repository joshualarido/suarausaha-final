import { z } from "zod";

export const proposedActionSchema = z.object({
  intent: z.enum([
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
    "account_transfer",
    "reversal",
  ]),
  amount: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paymentAccountId: z.string().min(1).nullable(),
  paymentAccountName: z.string().min(1).nullable(),
  destinationPaymentAccountId: z.string().min(1).nullable().optional(),
  destinationPaymentAccountName: z.string().min(1).nullable().optional(),
  description: z.string().trim().min(1),
  affectedObject: z.string().trim().nullable(),
  expectedEffects: z.array(z.string().trim().min(1)).min(1),
  warning: z.string().trim().nullable(),
});

export type ProposedAction = z.infer<typeof proposedActionSchema>;

export interface ParserMenuItemContext {
  id: string;
  name: string;
  aliases: string[];
  defaultPrice: number | null;
  category: string | null;
}

export interface ParserPaymentAccountContext {
  id: string;
  name: string;
  type: "cash" | "non_cash";
  isDefault: boolean;
}

export interface ParserLiabilityContext {
  id: string;
  lenderName: string;
  description: string | null;
  outstandingAmount: number;
}

export interface ParserReceivableContext {
  id: string;
  customerName: string;
  description: string | null;
  outstandingAmount: number;
}

export interface ParseIntentInput {
  message: string;
  businessId: string;
  userId: string;
  today: string;
  defaultPaymentAccountId: string | null;
  defaultPaymentAccountName: string | null;
  paymentAccounts: ParserPaymentAccountContext[];
  menuItems: ParserMenuItemContext[];
  openLiabilities?: ParserLiabilityContext[];
  openReceivables?: ParserReceivableContext[];
  clarification?: {
    originalMessage: string;
    previousPayload: Record<string, unknown>;
    answer: string;
  };
}

export type ParseIntentResult =
  | {
      status: "parsed";
      proposedAction: ProposedAction;
      missingFields: string[];
      validationErrors: string[];
      confidence: number;
      parserModel: string;
      parserVersion: string;
      structuredPayload: ProposedAction;
      requiresConfirmationReason?: "clarified_ambiguity";
    }
  | {
      status: "needs_clarification";
      proposedAction: null;
      missingFields: string[];
      validationErrors: string[];
      question: string;
      options: Array<{ label: string; value: string }>;
      confidence: number;
      parserModel: string;
      parserVersion: string;
      structuredPayload: Record<string, unknown>;
    };

export interface IntentParser {
  parse(input: ParseIntentInput): Promise<ParseIntentResult>;
}
