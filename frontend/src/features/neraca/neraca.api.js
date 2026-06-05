import { apiRequest, getApiBaseUrl } from "@/lib/api-client";

function queryString(params) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  });
  const value = search.toString();
  return value ? `?${value}` : "";
}

export async function previewNeraca(reportDate) {
  return apiRequest(`/api/v1/neraca/preview${queryString({ reportDate })}`);
}

export async function createNeracaSnapshot(reportDate) {
  return apiRequest("/api/v1/neraca/snapshots", {
    method: "POST",
    body: { reportDate },
    notifyOnSuccess: true,
    successMessage: "Laporan neraca berhasil disimpan.",
  });
}

export async function listNeracaSnapshots({ page = 1, limit = 20 } = {}) {
  return apiRequest(`/api/v1/neraca/snapshots${queryString({ page, limit })}`);
}

export async function getNeracaSnapshot(snapshotId) {
  return apiRequest(`/api/v1/neraca/snapshots/${snapshotId}`);
}

export async function downloadNeracaPdf(snapshot) {
  const response = await fetch(`${getApiBaseUrl()}/api/v1/neraca/snapshots/${snapshot.id}/pdf`, {
    method: "GET",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("PDF neraca belum bisa diunduh.");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `neraca-${snapshot.reportDate}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
