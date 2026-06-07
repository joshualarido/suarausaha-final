import { ArrowRight, HelpCircle, Hourglass } from "lucide-react";
import { AutoWriteSummary } from "./AutoWriteSummary";
import { ClarificationCard } from "./ClarificationCard";
import { ConfirmationCard } from "./ConfirmationCard";
import { SuraAnswerCard } from "./SuraAnswerCard";
import { TutorialVideoArtifact } from "./TutorialVideoArtifact";

export function ChatMessageList({
  chatItems,
  isBusy,
  onCancel,
  onClarificationAnswer,
  onConfirm,
  onHelpRequest,
  pendingConfirmationRequestId,
}) {
  return (
    <div className="flex w-full flex-col gap-3">
      {chatItems.length === 0 ? (
        <div className="rounded-xl border border-border bg-secondary/20 p-4 text-left sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-card text-primary shadow-sm">
                <HelpCircle className="h-5 w-5" aria-hidden />
              </div>
              <div className="min-w-0">
                <h2 className="su-type-section-title text-foreground">Mau mulai dari mana?</h2>
                <p className="su-type-body mt-2 text-muted-foreground">
                  Tanya Sura cara mencatat transaksi, cek ringkasan usaha, atau minta neraca.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onHelpRequest}
              disabled={isBusy}
              className="su-type-ui inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              <span>Tanya Sura bisa apa?</span>
              <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <p className="su-type-helper mt-4 rounded-lg border border-[#D4E1F0] bg-card px-3 py-2 text-muted-foreground">
            Data keuangan tetap hanya disimpan setelah kamu cek dan konfirmasi.
          </p>
        </div>
      ) : null}

      {chatItems.map((item) => {
        if (item.type === "text") {
          const isUser = item.role === "user";
          return (
            <div key={item.id} className={`motion-chat-message flex ${isUser ? "justify-end" : "justify-start"}`}>
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
              isBusy={isBusy}
              item={item}
              onCancel={onCancel}
              onConfirm={onConfirm}
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

        if (item.type === "tutorial_video_artifact") {
          return (
            <TutorialVideoArtifact
              key={item.id}
              title={item.data?.title}
              description={item.data?.description}
            />
          );
        }

        return null;
      })}

      {isBusy ? (
        <div className="motion-chat-message flex justify-start">
          <div className="motion-processing max-w-[94%] rounded-2xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground sm:max-w-[92%]">
            <div className="flex items-center gap-2">
              <Hourglass className="h-4 w-4 animate-spin" aria-hidden />
              <span>Sura sedang memproses pesan...</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
