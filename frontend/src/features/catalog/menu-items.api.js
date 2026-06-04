import { apiRequest } from "@/lib/api-client";

export async function getMenuItems() {
  return apiRequest("/api/v1/menu-items");
}

export async function createMenuItem(menuItem) {
  return apiRequest("/api/v1/menu-items", {
    method: "POST",
    body: menuItem,
  });
}

export async function updateMenuItem(menuItemId, menuItem) {
  return apiRequest(`/api/v1/menu-items/${menuItemId}`, {
    method: "PATCH",
    body: menuItem,
  });
}

export async function removeMenuItem(menuItemId) {
  return apiRequest(`/api/v1/menu-items/${menuItemId}`, {
    method: "DELETE",
  });
}
