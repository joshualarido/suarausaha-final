import { Hourglass, MessageCircle } from "lucide-react";
import { AutoWriteSummary } from "./AutoWriteSummary";
import { ClarificationCard } from "./ClarificationCard";
import { ConfirmationCard } from "./ConfirmationCard";
import { SuraAnswerCard } from "./SuraAnswerCard";

const examplePrompts = [
  "Jual ayam geprek 500 ribu tunai",
  "Bayar listrik 100 ribu pakai kas",
  "Beli stok ayam 200 ribu",
  "Buat neraca bulan ini",
];

export function ChatMessageList({
  activeConfirmation,
  chatItems,
  editFields,
  isBusy,
  isEditing,
  onCancel,
  onCancelEdit,
  onClarificationAnswer,
  onConfirm,
  onEditFieldChange,
  onEditSubmit,
  onPromptSelect,
  onStartEdit,
  pendingConfirmationRequestId,
}) {
  return (
    <div className="flex w-full flex-col gap-3">
      {chatItems.length === 0 ? (
        <div className="rounded-xl border border-border bg-secondary/20 p-4 text-left sm:p-5">
          <h2 className="su-type-section-title text-foreground">Mulai catat transaksi lewat chat</h2>
          <p className="su-type-body mt-2 text-muted-foreground">
            Ketik seperti ngobrol. Nanti saya kasih kartu konfirmasi langsung di chat ini.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {examplePrompts.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => onPromptSelect(example)}
                className="flex items-center gap-2 rounded-lg border border-[#D4E1F0] bg-card px-3 py-2 text-left text-sm text-primary hover:bg-secondary/40"
              >
                <MessageCircle className="h-4 w-4" />
                <span>{example}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {chatItems.map((item) => {
        if (item.type === "text") {
          const isUser = item.role === "user";
          return (
            <div key={item.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[94%] rounded-2xl px-4 py-3 text-sm sm:max-w-[85%] ${
                  isUser ? "bg-primary text-primary-foreground" : "border border-border bg-card text-foreground"
                }`}
              >
                {item.text}
              </div>
            </div>
          );
        }

        if (item.type === "clarification") {
          return (
            <ClarificationCard
              key={item.id}
              item={item}
              isBusy={isBusy}
              onAnswer={onClarificationAnswer}
            />
          );
        }

        if (item.type === "confirmation") {
          return (
            <ConfirmationCard
              key={item.id}
              activeConfirmation={activeConfirmation}
              editFields={editFields}
              isBusy={isBusy}
              isEditing={isEditing}
              item={item}
              onCancel={onCancel}
              onCancelEdit={onCancelEdit}
              onConfirm={onConfirm}
              onEditFieldChange={onEditFieldChange}
              onEditSubmit={onEditSubmit}
              onStartEdit={onStartEdit}
              pendingConfirmationRequestId={pendingConfirmationRequestId}
            />
          );
        }

        if (item.type === "auto_write_summary") {
          return <AutoWriteSummary key={item.id} item={item} />;
        }

        if (item.type === "sura_answer") {
          return <SuraAnswerCard key={item.id} item={item} />;
        }

        return null;
      })}

      {isBusy ? (
        <div className="flex justify-start">
          <div className="max-w-[94%] rounded-2xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground sm:max-w-[92%]">
            <div className="flex items-center gap-2">
              <Hourglass className="h-4 w-4 animate-spin" aria-hidden />
              <span>Sura Assistant sedang memproses pesan...</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
