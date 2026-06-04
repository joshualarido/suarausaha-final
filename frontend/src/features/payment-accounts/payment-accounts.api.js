import { apiRequest } from "@/lib/api-client";

export async function getPaymentAccounts() {
  return apiRequest("/api/v1/payment-accounts");
}

export async function updatePaymentAccountName(paymentAccountId, name) {
  return apiRequest(`/api/v1/payment-accounts/${paymentAccountId}`, {
    method: "PATCH",
    body: { name },
  });
}

export async function createPaymentAccount(name) {
  return apiRequest("/api/v1/payment-accounts", {
    method: "POST",
    body: { name },
  });
}

export async function removePaymentAccount(paymentAccountId) {
  return apiRequest(`/api/v1/payment-accounts/${paymentAccountId}`, {
    method: "DELETE",
  });
}

export async function setDefaultPaymentAccount(paymentAccountId) {
  return apiRequest(`/api/v1/payment-accounts/${paymentAccountId}/default`, {
    method: "PATCH",
    body: {},
  });
}
