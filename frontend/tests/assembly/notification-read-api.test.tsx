import { afterEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
afterEach(() => vi.unstubAllGlobals());
it("persists read state through the backend endpoint", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);
  await api.markNotificationRead("notice-1");
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/v1/notifications/notice-1/read"), expect.objectContaining({ method: "POST" }));
});
it("scopes mark-all-read to the selected notification role", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);
  await api.markAllNotificationsRead("WAREHOUSE");
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/v1/notifications/read-all?role=WAREHOUSE"), expect.objectContaining({ method: "POST" }));
});
