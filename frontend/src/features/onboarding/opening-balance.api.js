import { apiRequest } from "@/lib/api-client";

export async function previewOpeningBalance(openingBalance) {
  return apiRequest("/api/v1/opening-balance/preview", {
    method: "POST",
    body: openingBalance,
    notifyOnSuccess: false,
  });
}

export async function confirmOpeningBalance(openingBalance) {
  return apiRequest("/api/v1/opening-balance/confirm", {
    method: "POST",
    body: openingBalance,
  });
}
