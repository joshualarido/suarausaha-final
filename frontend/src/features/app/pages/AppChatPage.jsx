import { useEffect, useRef, useState } from "react";
import { Check, Hourglass, LockKeyhole, MessageCircle, Mic, Paperclip, Pencil, RotateCcw, Send, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  cancelConfirmation,
  clarifyChatMessage,
  confirmConfirmation,
  editConfirmation,
  clearChatThread,
  parseChatMessage,
  undoLatestTransactionViaChat,
  getChatThread,
} from "@/lib/api-client";
import { formatDateId } from "@/lib/date-format";

const examplePrompts = [
  "Jual ayam geprek 500 ribu tunai",
  "Bayar listrik 100 ribu pakai kas",
  "Beli stok ayam 200 ribu",
  "Buat neraca bulan ini",
];

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

function formatIdr(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value ?? 0);
}

function normalizeConfirmation(data) {
  if (!data) return null;

  if (data.status === "requires_confirmation") {
    return {
      id: data.confirmationRequestId,
      proposedAction: data.proposedAction,
      confirmation: data.confirmation,
    };
  }

  return {
    id: data.id,
    proposedAction: data.proposedAction,
    confirmation: data,
  };
}

function normalizeProposedAction(value) {
  if (!value) return null;

  const parsed = typeof value === "string" ? (() => {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  })() : value;

  if (!parsed || typeof parsed !== "object") return null;
  if (typeof parsed.intent !== "string") return null;
  if (typeof parsed.amount !== "number") return null;
  if (typeof parsed.date !== "string") return null;
  if (typeof parsed.description !== "string") return null;

  return {
    intent: parsed.intent,
    amount: parsed.amount,
    date: parsed.date,
    paymentAccountName: parsed.paymentAccountName ?? null,
    affectedObject: parsed.affectedObject ?? null,
    description: parsed.description,
  };
}

export function AppChatPage() {
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("idle");
  const [chatItems, setChatItems] = useState([]);
  const [threadLoading, setThreadLoading] = useState(true);
  const [activeConfirmation, setActiveConfirmation] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editFields, setEditFields] = useState({
    amount: "",
    date: "",
    description: "",
  });
  const [pendingConfirmationRequestId, setPendingConfirmationRequestId] = useState(null);
  const [isClearingChat, setIsClearingChat] = useState(false);
  const [isUndoingLatest, setIsUndoingLatest] = useState(false);
  const chatScrollRef = useRef(null);

  function hydrateChatItemsFromThread(messages) {
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

  async function refreshChatThread() {
    const payload = await getChatThread();
    const messages = Array.isArray(payload?.data?.messages) ? payload.data.messages : [];
    setPendingConfirmationRequestId(payload?.data?.pendingConfirmationRequestId ?? null);
    setChatItems(hydrateChatItemsFromThread(messages));
  }

  useEffect(() => {
    let mounted = true;

    async function loadThread() {
      try {
        const payload = await getChatThread();
        if (!mounted) return;
        const messages = Array.isArray(payload?.data?.messages) ? payload.data.messages : [];
        setPendingConfirmationRequestId(payload?.data?.pendingConfirmationRequestId ?? null);
        setChatItems(hydrateChatItemsFromThread(messages));
      } catch {
        // Keep empty-state if thread cannot be loaded.
      } finally {
        if (mounted) {
          setThreadLoading(false);
        }
      }
    }

    loadThread();

    return () => {
      mounted = false;
    };
  }, []);

  function appendChatItem(item) {
    setChatItems((current) => [...current, { id: crypto.randomUUID(), ...item }]);
  }

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

  function appendSystemMessage(text) {
    appendChatItem({
      role: "assistant",
      type: "text",
      text,
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!message.trim() || status === "loading") return;

    const submittedMessage = message.trim();
    const latestChatItem = chatItems[chatItems.length - 1];
    const activeClarification = latestChatItem?.type === "clarification" ? latestChatItem : null;

    appendChatItem({
      role: "user",
      type: "text",
      text: submittedMessage,
    });

    setMessage("");
    setStatus("loading");
    setIsEditing(false);
    setActiveConfirmation(null);

    try {
      if (activeClarification) {
        await clarifyChatMessage(activeClarification.data.clarificationId, submittedMessage);
      } else {
        await parseChatMessage(submittedMessage);
      }
      await refreshChatThread();
      setStatus("idle");
    } catch (error) {
      appendSystemMessage(error.message || "Gagal membaca transaksi. Coba tulis lagi ya.");
      setStatus("idle");
    }
  }

  async function handleClarificationAnswer(item, answer) {
    if (status === "loading") return;

    setStatus("loading");

    try {
      await clarifyChatMessage(item.data.clarificationId, answer);
      await refreshChatThread();
      setStatus("idle");
    } catch (error) {
      appendSystemMessage(error.message || "Jawaban klarifikasi belum bisa diproses.");
      setStatus("idle");
    }
  }

  async function handleConfirm(item) {
    if (status === "loading") return;

    setStatus("loading");

    try {
      await confirmConfirmation(item.data.id);
      await refreshChatThread();
      setStatus("idle");
    } catch (error) {
      appendSystemMessage(error.message || "Konfirmasi gagal. Coba masukkan ulang transaksi.");
      setStatus("idle");
    }
  }

  async function handleCancel(item) {
    if (status === "loading") return;

    setStatus("loading");

    try {
      await cancelConfirmation(item.data.id);
      await refreshChatThread();
      setStatus("idle");
    } catch (error) {
      appendSystemMessage(error.message || "Konfirmasi gagal dibatalkan.");
      setStatus("idle");
    }
  }

  function startEditConfirmation(item) {
    setActiveConfirmation(item.data);
    setEditFields({
      amount: String(item.data.proposedAction.amount),
      date: item.data.proposedAction.date,
      description: item.data.proposedAction.description,
    });
    setIsEditing(true);
  }

  async function handleEditSubmit(event, item) {
    event.preventDefault();

    if (!item?.data || status === "loading") return;

    setStatus("loading");

    try {
      await editConfirmation(item.data.id, {
        amount: Number(editFields.amount),
        date: editFields.date,
        description: editFields.description,
      });
      await refreshChatThread();
      setIsEditing(false);
      setStatus("idle");
    } catch (error) {
      appendSystemMessage(error.message || "Edit konfirmasi gagal disimpan.");
      setStatus("idle");
    }
  }

  async function handleClearChat() {
    if (isBusy || isClearingChat) return;

    setIsClearingChat(true);
    setStatus("loading");
    setIsEditing(false);
    setActiveConfirmation(null);

    try {
      await clearChatThread();
      setChatItems([]);
      setPendingConfirmationRequestId(null);
      setStatus("idle");
    } catch (error) {
      appendSystemMessage(error.message || "Riwayat chat belum bisa dibersihkan.");
      setStatus("idle");
    } finally {
      setIsClearingChat(false);
    }
  }

  async function handleUndoLatestTransaction() {
    if (isBusy || isUndoingLatest) return;

    setIsUndoingLatest(true);
    setStatus("loading");
    setIsEditing(false);
    setActiveConfirmation(null);

    try {
      await undoLatestTransactionViaChat();
      await refreshChatThread();
      setStatus("idle");
    } catch (error) {
      appendSystemMessage(error.message || "Undo transaksi belum bisa diproses.");
      setStatus("idle");
    } finally {
      setIsUndoingLatest(false);
    }
  }

  const isBusy = status === "loading";

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
              <span className="text-xs text-muted-foreground/80">•</span>
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
              onClick={handleUndoLatestTransaction}
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
              onClick={handleClearChat}
              className="h-9 gap-2 px-3"
            >
              <Trash2 aria-hidden className="h-4 w-4" />
              {isClearingChat ? "Membersihkan..." : "Clear Chat"}
            </Button>
          </div>
        </div>
      </header>

      <div ref={chatScrollRef} className="su-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
        <div className="flex w-full flex-col gap-3">
          {chatItems.length === 0 ? (
            <div className="rounded-xl border border-border bg-secondary/20 p-5 text-left">
              <h2 className="su-type-section-title text-foreground">Mulai catat transaksi lewat chat</h2>
              <p className="su-type-body mt-2 text-muted-foreground">
                Ketik seperti ngobrol. Nanti saya kasih kartu konfirmasi langsung di chat ini.
              </p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {examplePrompts.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => setMessage(example)}
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
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
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
                <div key={item.id} className="flex justify-start">
                  <div className="max-w-[92%] rounded-2xl border border-[#D4E1F0] bg-card px-4 py-4">
                    <p className="text-xs text-primary">Perlu klarifikasi</p>
                    <p className="mt-1 text-sm text-foreground">{item.data.question}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {item.data.options.map((option) => (
                        <Button
                          key={option.value}
                          type="button"
                          size="default"
                          disabled={isBusy}
                          onClick={() => handleClarificationAnswer(item, option.value)}
                          className="px-4 py-2.5"
                        >
                          {option.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            }

            if (item.type === "confirmation") {
              const proposedAction = item.data.proposedAction;
              const editingThisCard = isEditing && activeConfirmation?.id === item.data.id;
              const isCardActive = item.data.id === pendingConfirmationRequestId;

              return (
                <div key={item.id} className="flex justify-start">
                  <div className="max-w-[92%] rounded-2xl border border-[#D4E1F0] bg-card px-4 py-4">
                    <p className="text-xs text-primary">Butuh konfirmasi</p>
                    {!isCardActive ? (
                      <p className="mt-1 text-xs text-muted-foreground">Konfirmasi ini sudah tidak aktif.</p>
                    ) : null}
                    <p className="mt-1 text-sm text-foreground">
                      {intentLabels[proposedAction.intent] ?? proposedAction.intent}
                    </p>

                    {editingThisCard ? (
                      <form onSubmit={(event) => handleEditSubmit(event, item)} className="mt-3 grid gap-2">
                        <input
                          type="number"
                          min="1"
                          value={editFields.amount}
                          onChange={(event) => setEditFields((current) => ({ ...current, amount: event.target.value }))}
                          className="h-10 rounded-lg border border-border px-3 text-sm"
                        />
                        <input
                          type="date"
                          value={editFields.date}
                          onChange={(event) => setEditFields((current) => ({ ...current, date: event.target.value }))}
                          className="h-10 rounded-lg border border-border px-3 text-sm"
                        />
                        <input
                          type="text"
                          value={editFields.description}
                          onChange={(event) =>
                            setEditFields((current) => ({ ...current, description: event.target.value }))
                          }
                          className="h-10 rounded-lg border border-border px-3 text-sm"
                        />
                        <div className="flex gap-2">
                          <Button type="submit" size="sm" disabled={isBusy}>
                            Simpan edit
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => setIsEditing(false)}>
                            Batal
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <dl className="mt-3 space-y-1 text-sm">
                          <div className="flex justify-between gap-3">
                            <dt className="text-muted-foreground">Jumlah</dt>
                            <dd>{formatIdr(proposedAction.amount)}</dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt className="text-muted-foreground">Tanggal</dt>
                            <dd>{formatDateId(proposedAction.date)}</dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt className="text-muted-foreground">Akun</dt>
                            <dd>{proposedAction.paymentAccountName ?? "Kas"}</dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt className="text-muted-foreground">Keterangan</dt>
                            <dd className="text-right">{proposedAction.description}</dd>
                          </div>
                        </dl>
                        <ul className="mt-3 space-y-1 text-sm">
                          {proposedAction.expectedEffects.map((effect) => (
                            <li key={effect} className="flex gap-2 text-muted-foreground">
                              <Check className="mt-0.5 h-4 w-4 text-primary" />
                              <span>{effect}</span>
                            </li>
                          ))}
                        </ul>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="default"
                            disabled={isBusy || !isCardActive}
                            onClick={() => handleConfirm(item)}
                            className="px-4 py-2.5"
                          >
                            <Check className="h-4 w-4" />
                            Simpan
                          </Button>
                          <Button
                            type="button"
                            size="default"
                            variant="outline"
                            disabled={isBusy || !isCardActive}
                            onClick={() => startEditConfirmation(item)}
                            className="px-4 py-2.5"
                          >
                            <Pencil className="h-4 w-4" />
                            Edit
                          </Button>
                          <Button
                            type="button"
                            size="default"
                            variant="destructive"
                            disabled={isBusy || !isCardActive}
                            onClick={() => handleCancel(item)}
                            className="px-4 py-2.5"
                          >
                            <X className="h-4 w-4" />
                            Batalkan
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            }

            if (item.type === "auto_write_summary") {
              const action = item.data.proposedAction;

              return (
                <div key={item.id} className="flex justify-start">
                  <div className="max-w-[92%] rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-4">
                    <p className="text-xs font-medium text-emerald-700">Tersimpan otomatis</p>
                    <p className="mt-1 text-sm text-foreground">{item.data.message}</p>
                    <dl className="mt-3 space-y-1 text-sm">
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">Jenis</dt>
                        <dd>{intentLabels[action.intent] ?? action.intent}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">Jumlah</dt>
                        <dd>{formatIdr(action.amount)}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">Tanggal</dt>
                        <dd>{formatDateId(action.date)}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">Akun</dt>
                        <dd>{action.paymentAccountName ?? "Kas"}</dd>
                      </div>
                      {action.affectedObject ? (
                        <div className="flex justify-between gap-3">
                          <dt className="text-muted-foreground">Objek</dt>
                          <dd className="text-right">{action.affectedObject}</dd>
                        </div>
                      ) : null}
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">Keterangan</dt>
                        <dd className="text-right">{action.description}</dd>
                      </div>
                    </dl>
                  </div>
                </div>
              );
            }

            return null;
          })}

          {isBusy ? (
            <div className="flex justify-start">
              <div className="max-w-[92%] rounded-2xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Hourglass className="h-4 w-4 animate-spin" aria-hidden />
                  <span>Sura Assistant sedang memproses pesan...</span>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="border-t border-border bg-card px-4 py-4 md:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex min-h-14 flex-1 items-center gap-3 rounded-lg border border-border bg-card px-4 shadow-sm focus-within:border-primary/45 focus-within:ring-3 focus-within:ring-ring/15">
            <Paperclip aria-hidden className="h-5 w-5 shrink-0 text-muted-foreground" />
            <input
              type="text"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Contoh: jual ayam geprek 500 ribu tunai"
              className="su-type-field h-12 min-w-0 flex-1 border-0 bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            <button
              type="button"
              disabled
              aria-label="Input suara belum tersedia"
              title="Input suara belum tersedia"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
            >
              <Mic aria-hidden className="h-5 w-5" />
            </button>
          </div>

          <Button type="submit" disabled={isBusy || !message.trim()} className="su-type-ui h-14 gap-2 rounded-lg px-7">
            <Send aria-hidden className="h-5 w-5" />
            {isBusy ? "Memproses..." : "Kirim"}
          </Button>
        </div>

        <p className="su-type-helper mt-4 flex items-center justify-center gap-2 text-muted-foreground">
          <LockKeyhole aria-hidden className="h-4 w-4" />
          Transaksi sederhana bisa langsung tersimpan. Transaksi lain tetap pakai konfirmasi.
        </p>
      </form>
    </section>
  );
}
