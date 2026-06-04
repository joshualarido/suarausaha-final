import { useEffect, useRef, useState } from "react";
import { Hourglass, LockKeyhole, Mic, Paperclip, RotateCcw, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatMessageList } from "@/features/app/components/ChatMessageList";
import { useChatThread } from "./useChatThread";

export function AppChatPage() {
  const [message, setMessage] = useState("");
  const chatScrollRef = useRef(null);
  const {
    activeConfirmation,
    answerClarification,
    cancelEditConfirmation,
    cancelItem,
    chatItems,
    clearThread,
    confirmItem,
    editFields,
    isBusy,
    isClearingChat,
    isEditing,
    isUndoingLatest,
    pendingConfirmationRequestId,
    setEditFields,
    startEditConfirmation,
    status,
    submitConfirmationEdit,
    submitMessage,
    threadLoading,
    undoLatestTransaction,
  } = useChatThread();

  function scrollChatToBottom(behavior = "smooth") {
    if (!chatScrollRef.current) return;
    chatScrollRef.current.scrollTo({
      top: chatScrollRef.current.scrollHeight,
      behavior,
    });
  }

  useEffect(() => {
    if (threadLoading) return;
    scrollChatToBottom(chatItems.length <= 1 ? "auto" : "smooth");
  }, [chatItems.length, status, threadLoading]);

  async function handleSubmit(event) {
    event.preventDefault();

    if (!message.trim() || isBusy) return;

    const submittedMessage = message.trim();
    setMessage("");
    const sent = await submitMessage(submittedMessage);

    if (!sent) {
      setMessage(submittedMessage);
    }
  }

  function handleEditFieldChange(field, value) {
    setEditFields((current) => ({
      ...current,
      [field]: value,
    }));
  }

  if (threadLoading) {
    return (
      <section className="flex h-full min-h-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-col items-center gap-4 px-4 py-10 text-center">
          <Hourglass className="h-10 w-10 animate-spin text-primary" aria-hidden />
          <div>
            <h2 className="su-type-section-title text-foreground">Memuat obrolan...</h2>
            <p className="su-type-body mt-1 text-muted-foreground">Mohon tunggu sebentar.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <header className="border-b border-border bg-card px-4 py-4 md:px-6">
        <div className="flex w-full items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="h-11 w-11 rounded-full border border-border bg-secondary/50" aria-hidden />
            <div className="min-w-0">
              <p className="su-type-ui truncate text-foreground">Sura Assistant</p>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
                <span className="text-xs text-muted-foreground">Online</span>
                <span className="text-xs text-muted-foreground/80">|</span>
                <span className="text-xs text-muted-foreground">Siap bantu catat transaksi</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isBusy || isUndoingLatest}
              onClick={undoLatestTransaction}
              className="h-9 gap-2 px-3"
            >
              <RotateCcw aria-hidden className="h-4 w-4" />
              {isUndoingLatest ? "Undo..." : "Undo"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isBusy || isClearingChat}
              onClick={clearThread}
              className="h-9 gap-2 px-3"
            >
              <Trash2 aria-hidden className="h-4 w-4" />
              {isClearingChat ? "Membersihkan..." : "Clear Chat"}
            </Button>
          </div>
        </div>
      </header>

      <div ref={chatScrollRef} className="su-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
        <ChatMessageList
          activeConfirmation={activeConfirmation}
          chatItems={chatItems}
          editFields={editFields}
          isBusy={isBusy}
          isEditing={isEditing}
          onCancel={cancelItem}
          onCancelEdit={cancelEditConfirmation}
          onClarificationAnswer={answerClarification}
          onConfirm={confirmItem}
          onEditFieldChange={handleEditFieldChange}
          onEditSubmit={submitConfirmationEdit}
          onPromptSelect={setMessage}
          onStartEdit={startEditConfirmation}
          pendingConfirmationRequestId={pendingConfirmationRequestId}
        />
      </div>

      <form onSubmit={handleSubmit} className="border-t border-border bg-card px-4 py-4 md:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex min-h-14 flex-1 items-center gap-3 rounded-lg border border-border bg-card px-4 shadow-sm focus-within:border-primary/45 focus-within:ring-3 focus-within:ring-ring/15">
            <Paperclip aria-hidden className="h-5 w-5 shrink-0 text-muted-foreground" />
            <input
              type="text"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              disabled={isBusy}
              placeholder="Tulis transaksi usaha..."
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            <button type="button" disabled={isBusy} className="text-muted-foreground disabled:opacity-50">
              <Mic aria-hidden className="h-5 w-5" />
            </button>
          </div>

          <Button type="submit" disabled={isBusy || !message.trim()} className="h-12 gap-2 px-5">
            <Send aria-hidden className="h-4 w-4" />
            Kirim
          </Button>
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <LockKeyhole aria-hidden className="h-3.5 w-3.5" />
          <span>Data hanya disimpan setelah kamu konfirmasi.</span>
        </div>
      </form>
    </section>
  );
}
