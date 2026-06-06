import { apiRequest } from "@/lib/api-client";

function buildQueryString(query = {}) {
  const params = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    params.set(key, String(value));
  });

  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

export async function getTransactions(query = {}) {
  return apiRequest(`/api/v1/transactions${buildQueryString(query)}`);
}

export async function getTransactionDetail(transactionId) {
  return apiRequest(`/api/v1/transactions/${transactionId}`);
}

export async function getInventorySummary() {
  return apiRequest("/api/v1/inventory-summary");
}

export async function getAssetSummary() {
  return apiRequest("/api/v1/asset-summary");
}

export async function getLiabilitiesSummary() {
  return apiRequest("/api/v1/liabilities");
}

export async function getReceivablesSummary() {
  return apiRequest("/api/v1/receivables");
}
