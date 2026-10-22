import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useNotificationAlerts } from "@/hooks/use-notification-alerts";
import { acknowledgeVisibleNotifications } from "@/lib/notification-state";
import { api } from "@/lib/api-client";
vi.mock("@/lib/api-client", () => ({ api: { getNotifications: vi.fn() } }));
const old = { id: "old", title: "Existing notice", is_read: false, created_at: "2026-10-21T10:00:00" };
const fresh = { id: "new", title: "New GRN", is_read: false, created_at: "2026-10-21T11:00:00" };
beforeEach(() => { vi.useFakeTimers(); vi.mocked(api.getNotifications).mockReset(); });
afterEach(() => vi.useRealTimers());
const settle = async () => { await act(async () => { await Promise.resolve(); }); };

it("counts each notification once without alerting for old notices on login", async () => {
  vi.mocked(api.getNotifications).mockResolvedValue([old, old]);
  const { result } = renderHook(() => useNotificationAlerts("SUPPLIER", "supplier"));
  await settle();
  expect(result.current.unreadCount).toBe(1);
  expect(result.current.alert).toBeNull();
});

it("shows a card for a newly polled notification and expires it", async () => {
  vi.mocked(api.getNotifications).mockResolvedValueOnce([old]).mockResolvedValue([fresh, old]);
  const { result } = renderHook(() => useNotificationAlerts("WAREHOUSE", "warehouse"));
  await settle();
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(result.current.alert?.id).toBe("new");
  expect(result.current.unreadCount).toBe(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(7000); });
  expect(result.current.alert).toBeNull();
});

it("clears the badge after the visible notifications are acknowledged and does not replay them", async () => {
  vi.mocked(api.getNotifications).mockResolvedValue([old]);
  const { result } = renderHook(() => useNotificationAlerts("SUPPLIER", "supplier"));
  await settle();
  const markRead = vi.fn().mockResolvedValue({ success: true });
  await act(async () => { await acknowledgeVisibleNotifications([old, old], markRead); });
  expect(markRead).toHaveBeenCalledOnce();
  expect(markRead).toHaveBeenCalledWith("old");
  expect(result.current.unreadCount).toBe(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(result.current.unreadCount).toBe(0);
  expect(result.current.alert).toBeNull();
});

it("does not hide unread notifications when saving their read state fails", async () => {
  vi.mocked(api.getNotifications).mockResolvedValue([old]);
  const { result } = renderHook(() => useNotificationAlerts("SUPPLIER", "supplier"));
  await settle();
  await expect(acknowledgeVisibleNotifications([old], vi.fn().mockRejectedValue(new Error("offline")))).rejects.toThrow("offline");
  expect(result.current.unreadCount).toBe(1);
});

it("stops polling after unmount", async () => {
  vi.mocked(api.getNotifications).mockResolvedValue([]);
  const { unmount } = renderHook(() => useNotificationAlerts("SUPPLIER", "supplier"));
  await settle();
  unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(api.getNotifications).toHaveBeenCalledOnce();
});
