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
  account_transfer: "Transfer antar akun",
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
    destinationPaymentAccountId: parsed.destinationPaymentAccountId ?? null,
    destinationPaymentAccountName: parsed.destinationPaymentAccountName ?? null,
    affectedObject: parsed.affectedObject ?? null,
    description: parsed.description,
    expectedEffects: Array.isArray(parsed.expectedEffects) ? parsed.expectedEffects.filter((effect) => typeof effect === "string") : [],
    warning: parsed.warning ?? null,
    salesOrder:
      parsed.salesOrder && Array.isArray(parsed.salesOrder.lines)
        ? {
            status: parsed.salesOrder.status,
            totalAmount: Number(parsed.salesOrder.totalAmount ?? parsed.amount),
            lines: parsed.salesOrder.lines
              .filter((line) => line && typeof line === "object")
              .map((line) => ({
                productId: String(line.productId ?? ""),
                productName: String(line.productName ?? ""),
                spokenLabel: String(line.spokenLabel ?? ""),
                quantity: Number(line.quantity ?? 0),
                unitPrice: Number(line.unitPrice ?? 0),
                subtotal: Number(line.subtotal ?? 0),
                matchStatus: String(line.matchStatus ?? "matched"),
              }))
              .filter((line) => line.productId && line.productName && line.quantity > 0),
          }
        : null,
  };
}

export function normalizeConfirmation(data) {
  if (!data) return null;

  if (data.status === "requires_confirmation") {
    const proposedNeracaReport = data.proposedNeracaReport ?? data.confirmation?.proposedNeracaReport?.preview ?? data.confirmation?.proposedNeracaReport;
    if (proposedNeracaReport) {
      return {
        id: data.confirmationRequestId,
        type: "neraca_report",
        proposedNeracaReport,
        confirmation: data.confirmation,
      };
    }

    const proposedAction = normalizeProposedAction(data.proposedAction ?? data.confirmation?.proposedAction);
    if (!proposedAction) return null;

    return {
      id: data.confirmationRequestId,
      type: "transaction",
      proposedAction,
      confirmation: data.confirmation,
    };
  }

  if (data.type === "neraca_report") {
    const proposedPayload = data.proposedNeracaReport ?? {};
    return {
      id: data.id,
      type: "neraca_report",
      proposedNeracaReport: proposedPayload.preview ?? proposedPayload,
      confirmation: data,
    };
  }

  const proposedAction = normalizeProposedAction(data.proposedAction);
  if (!proposedAction) return null;

  return {
    id: data.id,
    type: "transaction",
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

        if (
          content.status === "analytics_answer" ||
          content.status === "help" ||
          content.status === "unsupported"
        ) {
          return {
            id: messageItem.id,
            role: "assistant",
            type: "sura_answer",
            data: {
              intent: String(content.intent ?? content.status),
              status: String(content.status),
              message: String(content.message ?? ""),
              data: content.data && typeof content.data === "object" ? content.data : {},
              warnings: Array.isArray(content.warnings) ? content.warnings.filter((warning) => typeof warning === "string") : [],
            },
          };
        }

        if (content.status === "confirmed" || content.status === "cancelled" || content.status === "cancelled_pending_confirmation") {
          return {
            id: messageItem.id,
            role: "assistant",
            type: "system_result",
            data: {
              status: String(content.status),
              message: String(content.message ?? ""),
            },
          };
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
