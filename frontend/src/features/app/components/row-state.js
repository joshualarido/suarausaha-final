import { cn } from "@/lib/utils";

const rowToneClasses = {
  success: {
    row: "border-l-4 border-success bg-success/5 hover:bg-success/10",
    text: "text-success",
    badge: "border-success/20 bg-success/10 text-success",
  },
  danger: {
    row: "border-l-4 border-danger bg-danger/5 hover:bg-danger/10",
    text: "text-danger",
    badge: "border-danger/20 bg-danger/10 text-danger",
  },
  warning: {
    row: "border-l-4 border-warning bg-warning/10 hover:bg-warning/15",
    text: "text-warning",
    badge: "border-warning/25 bg-warning/15 text-warning",
  },
  neutral: {
    row: "border-l-4 border-primary/30 bg-background hover:bg-muted/40",
    text: "text-foreground",
    badge: "border-border bg-secondary/60 text-primary",
  },
};

export const paymentStatusLabel = {
  open: "Belum dibayar",
  partial: "Sebagian",
  paid: "Lunas",
};

export function getRowToneClasses(tone = "neutral") {
  return rowToneClasses[tone] ?? rowToneClasses.neutral;
}

export function getTransactionRowTone(transaction = {}) {
  if (transaction.status === "reversed") return "danger";
  if (transaction.status === "reversal") return transaction.cashDirection === "out" ? "danger" : "neutral";
  if (transaction.cashDirection === "in") return "success";
  if (transaction.cashDirection === "out") return "danger";
  return "neutral";
}

export function getPaymentStatusTone(status) {
  if (status === "paid") return "success";
  if (status === "partial") return "warning";
  if (status === "open" || status === "unpaid") return "danger";
  return "neutral";
}

export function rowToneClassName(tone, className) {
  return cn(getRowToneClasses(tone).row, "transition-colors", className);
}

export function toneTextClassName(tone, className) {
  return cn(getRowToneClasses(tone).text, className);
}

export function toneBadgeClassName(tone, className) {
  return cn("inline-flex w-fit items-center rounded-md border px-2.5 py-1 text-xs font-semibold", getRowToneClasses(tone).badge, className);
}
