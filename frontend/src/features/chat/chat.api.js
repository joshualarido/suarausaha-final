import { apiRequest } from "@/lib/api-client";

export async function parseChatMessage(message) {
  return apiRequest("/api/v1/chat/parse", {
    method: "POST",
    body: { message },
    notifyOnSuccess: (payload) => payload?.data?.status === "saved_fast",
    successMessage: (payload) => payload?.data?.message || "Transaksi langsung disimpan.",
  });
}

export async function undoLatestTransactionViaChat() {
  return parseChatMessage("undo transaksi terakhir");
}

export async function getChatThread() {
  return apiRequest("/api/v1/chat/thread");
}

export async function clearChatThread() {
  return apiRequest("/api/v1/chat/thread", {
    method: "DELETE",
  });
}

export async function clarifyChatMessage(clarificationId, answer) {
  return apiRequest("/api/v1/chat/clarify", {
    method: "POST",
    body: { clarificationId, answer },
    notifyOnSuccess: (payload) => payload?.data?.status === "saved_fast",
    successMessage: (payload) => payload?.data?.message || "Transaksi langsung disimpan.",
  });
}
