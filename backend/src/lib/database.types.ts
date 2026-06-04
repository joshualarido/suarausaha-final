export interface BusinessRow {
  id: string;
  ownerId: string;
  name: string;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentAccountRow {
  id: string;
  businessId: string;
  name: string;
  type: "cash" | "non_cash";
  currentBalance: string;
  isDefault: boolean;
  status: "active" | "inactive";
  createdAt: Date;
  updatedAt: Date;
}

export interface MenuItemRow {
  id: string;
  businessId: string;
  name: string;
  aliases: unknown;
  defaultPrice: string | null;
  category: string | null;
  status: "active" | "inactive";
  createdAt: Date;
  updatedAt: Date;
}

export interface OpeningBalanceRow {
  id: string;
  businessId: string;
  cashBalance: string;
  nonCashBalance: string;
  inventoryValue: string;
  assetValue: string;
  debtValue: string;
  receivableValue: string;
  openingAssets: string;
  openingLiabilities: string;
  openingEquity: string;
  status: "pending" | "confirmed";
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TransactionRow {
  id: string;
  businessId: string;
  confirmationRequestId: string | null;
  parsedCommandId: string | null;
  paymentAccountId: string | null;
  type: string;
  amount: string;
  transactionDate: string;
  description: string;
  status: "confirmed" | "reversed";
  isReversal: boolean;
  reversedAt: Date | null;
  createdAt: Date;
  createdBy: string;
}

export interface TransactionEffectRow {
  id: string;
  transactionId: string;
  businessId: string;
  targetType: string;
  targetId: string;
  effectType: string;
  direction: "increase" | "decrease";
  amount: string;
  beforeAmount: string;
  afterAmount: string;
  createdAt: Date;
}

export interface InventorySummaryRow {
  id: string;
  businessId: string;
  name: string;
  estimatedValue: string;
  sourceOpeningBalanceId: string | null;
  sourceTransactionId: string | null;
  lastUpdatedAt: Date;
  status: "active" | "inactive";
  createdAt: Date;
  updatedAt: Date;
}

export interface AssetSummaryRow {
  id: string;
  businessId: string;
  name: string;
  value: string;
  recordedDate: string;
  sourceOpeningBalanceId: string | null;
  sourceTransactionId: string | null;
  status: "active" | "inactive";
  createdAt: Date;
  updatedAt: Date;
}

export interface LiabilityRow {
  id: string;
  businessId: string;
  lenderName: string;
  description: string | null;
  originalAmount: string;
  outstandingAmount: string;
  createdDate: string;
  status: "open" | "partial" | "paid";
  sourceOpeningBalanceId: string | null;
  sourceTransactionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReceivableRow {
  id: string;
  businessId: string;
  customerName: string;
  description: string | null;
  originalAmount: string;
  outstandingAmount: string;
  createdDate: string;
  status: "open" | "partial" | "paid";
  sourceOpeningBalanceId: string | null;
  sourceTransactionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TransactionCorrectionRow {
  id: string;
  businessId: string;
  originalTransactionId: string;
  reversalTransactionId: string;
  reason: string | null;
  status: "applied" | "failed";
  createdAt: Date;
  createdBy: string;
}

export interface ParsedCommandRow {
  id: string;
  businessId: string;
  userId: string;
  rawInputText: string;
  normalizedInputText: string | null;
  source: "text";
  detectedIntent: string | null;
  parserModel: string;
  parserVersion: string;
  confidence: string | null;
  structuredPayload: unknown;
  missingFields: unknown;
  validationErrors: unknown;
  status: "parsed" | "needs_clarification" | "failed";
  createdAt: Date;
  updatedAt: Date;
}

export interface ConfirmationRequestRow {
  id: string;
  businessId: string;
  userId: string;
  parsedCommandId: string | null;
  type: "transaction";
  status: "pending" | "confirmed" | "cancelled" | "expired" | "failed";
  proposedActionJson: unknown;
  summaryText: string;
  warningText: string | null;
  expectedEffectsJson: unknown;
  expiresAt: Date;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  resultingTransactionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatSessionRow {
  id: string;
  businessId: string;
  userId: string;
  status: "active" | "closed";
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatMessageRow {
  id: string;
  sessionId: string;
  businessId: string;
  userId: string;
  role: "user" | "assistant";
  kind: "text" | "clarification" | "confirmation_card" | "system_result";
  contentJson: unknown;
  parsedCommandId: string | null;
  confirmationRequestId: string | null;
  transactionId: string | null;
  createdAt: Date;
}

export interface DatabaseSchema {
  user: UserRow;
  business: BusinessRow;
  payment_accounts: PaymentAccountRow;
  menu_items: MenuItemRow;
  opening_balances: OpeningBalanceRow;
  parsed_commands: ParsedCommandRow;
  confirmation_requests: ConfirmationRequestRow;
  chat_sessions: ChatSessionRow;
  chat_messages: ChatMessageRow;
  transactions: TransactionRow;
  transaction_effects: TransactionEffectRow;
  inventory_summaries: InventorySummaryRow;
  asset_summaries: AssetSummaryRow;
  liabilities: LiabilityRow;
  receivables: ReceivableRow;
  transaction_corrections: TransactionCorrectionRow;
}
