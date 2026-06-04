import { useCallback, useEffect, useState } from "react";
import { hydrateChatItemsFromThread } from "@/features/app/chat-normalizers";
import { clearChatThread, clarifyChatMessage, getChatThread, parseChatMessage, undoLatestTransactionViaChat } from "@/features/chat/chat.api";
import { cancelConfirmation, confirmConfirmation, editConfirmation } from "@/features/confirmations/confirmations.api";

export function useChatThread() {
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

  function startEditConfirmation(item) {
    setActiveConfirmation(item.data);
    setEditFields({
      amount: String(item.data.proposedAction.amount),
      date: item.data.proposedAction.date,
      description: item.data.proposedAction.description,
    });
    setIsEditing(true);
  }

  async function submitConfirmationEdit(event, item) {
    event.preventDefault();

    if (!item?.data || isBusy) return;

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

  async function clearThread() {
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

  async function undoLatestTransaction() {
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

  return {
    activeConfirmation,
    answerClarification,
    cancelEditConfirmation: () => setIsEditing(false),
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
  };
}
