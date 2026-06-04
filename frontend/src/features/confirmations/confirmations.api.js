import { apiRequest } from "@/lib/api-client";

export async function confirmConfirmation(confirmationRequestId) {
  return apiRequest(`/api/v1/confirmations/${confirmationRequestId}/confirm`, {
    method: "POST",
    body: {},
    notifyOnSuccess: true,
  });
}

export async function cancelConfirmation(confirmationRequestId) {
  return apiRequest(`/api/v1/confirmations/${confirmationRequestId}/cancel`, {
    method: "POST",
    body: {},
  });
}

export async function editConfirmation(confirmationRequestId, patch) {
  return apiRequest(`/api/v1/confirmations/${confirmationRequestId}`, {
    method: "PATCH",
    body: patch,
    notifyOnSuccess: false,
  });
}
