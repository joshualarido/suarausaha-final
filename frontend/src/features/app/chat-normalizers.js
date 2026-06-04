const intentLabels = {
  sales_income: "Pemasukan penjualan",
  general_expense: "Biaya usaha",
  inventory_purchase_value: "Pembelian stok",
  asset_record_or_purchase: "Aset usaha",
  liability_created: "Utang baru",
  liability_payment: "Pembayaran utang",
  receivable_created: "Piutang baru",
  receivable_payment: "Pembayaran piutang",
  owner_capital_contribution: "Modal pemilik",
  owner_withdrawal: "Ambil uang usaha",
  reversal: "Pembalikan transaksi",
};

export function getIntentLabel(intent) {
  return intentLabels[intent] ?? intent;
}

export function formatIdr(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value ?? 0);
}

function parseJsonObject(value) {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value;

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  return null;
}

export function normalizeProposedAction(value) {
  const parsed = parseJsonObject(value);
  if (!parsed) return null;
  if (typeof parsed.intent !== "string") return null;
  if (typeof parsed.amount !== "number") return null;
  if (typeof parsed.date !== "string") return null;
  if (typeof parsed.description !== "string") return null;

  return {
    intent: parsed.intent,
    amount: parsed.amount,
    date: parsed.date,
    paymentAccountId: parsed.paymentAccountId ?? null,
    paymentAccountName: parsed.paymentAccountName ?? null,
    affectedObject: parsed.affectedObject ?? null,
    description: parsed.description,
    expectedEffects: Array.isArray(parsed.expectedEffects) ? parsed.expectedEffects.filter((effect) => typeof effect === "string") : [],
    warning: parsed.warning ?? null,
  };
}

export function normalizeConfirmation(data) {
  if (!data) return null;

  if (data.status === "requires_confirmation") {
    const proposedAction = normalizeProposedAction(data.proposedAction ?? data.confirmation?.proposedAction);
    if (!proposedAction) return null;

    return {
      id: data.confirmationRequestId,
      proposedAction,
      confirmation: data.confirmation,
    };
  }

  const proposedAction = normalizeProposedAction(data.proposedAction);
  if (!proposedAction) return null;

  return {
    id: data.id,
    proposedAction,
    confirmation: data,
  };
}

export function hydrateChatItemsFromThread(messages) {
  return messages
    .map((messageItem) => {
      const content = messageItem.content && typeof messageItem.content === "object" ? messageItem.content : {};

      if (messageItem.kind === "text") {
        return {
          id: messageItem.id,
          role: messageItem.role,
          type: "text",
          text: String(content.text ?? content.message ?? ""),
        };
      }

      if (messageItem.kind === "clarification") {
        return {
          id: messageItem.id,
          role: "assistant",
          type: "clarification",
          data: {
            clarificationId: content.clarificationId,
            question: content.question,
            options: Array.isArray(content.options) ? content.options : [],
            missingFields: Array.isArray(content.missingFields) ? content.missingFields : [],
          },
        };
      }

      if (messageItem.kind === "confirmation_card") {
        const normalized = normalizeConfirmation(content);
        if (!normalized) return null;

        return {
          id: messageItem.id,
          role: "assistant",
          type: "confirmation",
          data: normalized,
        };
      }

      if (messageItem.kind === "system_result") {
        if (content.status === "saved_fast") {
          const proposedAction = normalizeProposedAction(content.proposedAction);
          if (proposedAction) {
            return {
              id: messageItem.id,
              role: "assistant",
              type: "auto_write_summary",
              data: {
                message: String(content.message ?? "Transaksi langsung disimpan."),
                transactionId: String(content.transactionId ?? ""),
                captureMode: String(content.captureMode ?? "auto_fast"),
                proposedAction,
              },
            };
          }
        }

        return {
          id: messageItem.id,
          role: "assistant",
          type: "text",
          text: String(content.message ?? ""),
        };
      }

      return null;
    })
    .filter(Boolean);
}
