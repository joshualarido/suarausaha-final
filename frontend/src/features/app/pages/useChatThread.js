import { useCallback, useEffect, useState } from "react";
import { hydrateChatItemsFromThread } from "@/features/app/chat-normalizers";
import { clearChatThread, clarifyChatMessage, getChatThread, parseChatMessage, querySura, undoLatestTransactionViaChat } from "@/features/chat/chat.api";
import { cancelConfirmation, confirmConfirmation } from "@/features/confirmations/confirmations.api";

function isTutorialVideoRequest(message) {
  const normalized = message.trim().toLowerCase();
  return (
    /\b(video tutorial|tutorial video|panduan video)\b/.test(normalized) ||
    (/\b(tutorial|cara pakai|panduan)\b/.test(normalized) && /\b(video|sura|aplikasi)\b/.test(normalized))
  );
}

export function useChatThread() {
  const [status, setStatus] = useState("idle");
  const [chatItems, setChatItems] = useState([]);
  const [threadLoading, setThreadLoading] = useState(true);
  const [pendingConfirmationRequestId, setPendingConfirmationRequestId] = useState(null);
  const [isClearingChat, setIsClearingChat] = useState(false);
  const [isUndoingLatest, setIsUndoingLatest] = useState(false);

  const isBusy = status === "loading";

  const appendChatItem = useCallback((item) => {
    setChatItems((current) => [...current, { id: crypto.randomUUID(), ...item }]);
  }, []);

  const appendSystemMessage = useCallback((text) => {
    appendChatItem({
      role: "assistant",
      type: "text",
      text,
    });
  }, [appendChatItem]);

  const refreshChatThread = useCallback(async () => {
    const payload = await getChatThread();
    const messages = Array.isArray(payload?.data?.messages) ? payload.data.messages : [];
    setPendingConfirmationRequestId(payload?.data?.pendingConfirmationRequestId ?? null);
    setChatItems(hydrateChatItemsFromThread(messages));
  }, []);

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

  async function submitMessage(message) {
    if (!message.trim() || isBusy) return false;

    const submittedMessage = message.trim();
    const latestChatItem = chatItems[chatItems.length - 1];
    const activeClarification = latestChatItem?.type === "clarification" ? latestChatItem : null;

    appendChatItem({
      role: "user",
      type: "text",
      text: submittedMessage,
    });

    setStatus("loading");

    try {
      let handledLocally = false;

      if (activeClarification) {
        await clarifyChatMessage(activeClarification.data.clarificationId, submittedMessage);
      } else if (isTutorialVideoRequest(submittedMessage)) {
        appendChatItem({
          role: "assistant",
          type: "tutorial_video_artifact",
          data: {
            title: "Video tutorial Sura",
            description: "Ini placeholder untuk artifact video tutorial. Nanti area ini bisa memuat video panduan asli.",
            aspectRatio: "16:9",
          },
        });
        handledLocally = true;
      } else if (pendingConfirmationRequestId) {
        await parseChatMessage(submittedMessage);
      } else {
        const suraPayload = await querySura(submittedMessage);
        const suraType = suraPayload?.data?.type;

        if (suraType === "write_action_redirect" || suraType === "report_request_redirect") {
          await parseChatMessage(submittedMessage);
        }
      }
      if (!handledLocally) {
        await refreshChatThread();
      }
      setStatus("idle");
      return true;
    } catch (error) {
      appendSystemMessage(error.message || "Gagal membaca transaksi. Coba tulis lagi ya.");
      setStatus("idle");
      return false;
    }
  }

  async function answerClarification(item, answer) {
    if (isBusy) return;

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

  async function confirmItem(item) {
    if (isBusy) return;

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

  async function cancelItem(item) {
    if (isBusy) return;

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

  async function clearThread() {
    if (isBusy || isClearingChat) return;

    setIsClearingChat(true);
    setStatus("loading");

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

  async function undoLatestTransaction() {
    if (isBusy || isUndoingLatest) return;

    setIsUndoingLatest(true);
    setStatus("loading");

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

  return {
    answerClarification,
    cancelItem,
    chatItems,
    clearThread,
    confirmItem,
    isBusy,
    isClearingChat,
    isUndoingLatest,
    pendingConfirmationRequestId,
    status,
    submitMessage,
    threadLoading,
    undoLatestTransaction,
  };
}
