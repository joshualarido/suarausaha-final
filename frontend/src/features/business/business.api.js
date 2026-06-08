import { apiRequest } from "@/lib/api-client";

export async function getBusinessProfile() {
  return apiRequest("/api/v1/business");
}

export async function createBusinessProfile(name) {
  return apiRequest("/api/v1/business", {
    method: "POST",
    body: { name },
  });
}

export async function updateBusinessProfile(name) {
  return apiRequest("/api/v1/business", {
    method: "PATCH",
    body: { name },
  });
}

export async function completeProductTour() {
  return apiRequest("/api/v1/business/product-tour/complete", {
    method: "POST",
    body: {},
    notifyOnSuccess: false,
  });
}

export async function debugResetOnboarding() {
  return apiRequest("/api/v1/debug/reset-onboarding", {
    method: "POST",
    body: {},
    notifyOnSuccess: false,
  });
}
