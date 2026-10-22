import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { isUnreadNotification, notificationId, uniqueNotifications, type NotificationRecord } from "@/lib/notification-state";

export function useNotificationAlerts(role: string | null, account?: string) {
  const [rows, setRows] = useState<NotificationRecord[]>([]);
  const [alert, setAlert] = useState<NotificationRecord | null>(null);
  const dismissAlert = useCallback(() => setAlert(null), []);
  useEffect(() => {
    let active = true;
    let busy = false;
    let known: Set<string> | null = null;
    let alertTimer: ReturnType<typeof setTimeout> | undefined;
    const readIds = new Set<string>();
    setRows([]);
    setAlert(null);
    if (!role) return;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        const result = await api.getNotifications(role);
        if (!active) return;
        const next = uniqueNotifications(Array.isArray(result) ? result : []).map((item) =>
          readIds.has(notificationId(item)) ? { ...item, is_read: true } : item);
        const newest = known ? next.filter((item) => !known!.has(notificationId(item)) && isUnreadNotification(item))
          .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0] : undefined;
        known = new Set([...(known || []), ...next.map(notificationId)]);
        setRows(next);
        if (newest) {
          setAlert(newest);
          if (alertTimer) clearTimeout(alertTimer);
          alertTimer = setTimeout(() => { if (active) setAlert(null); }, 7000);
        }
      } catch {
        // Keep the last successful count during transient network failures.
      } finally { busy = false; }
    };
    const onRead = (event: Event) => {
      for (const id of (event as CustomEvent<string[]>).detail || []) readIds.add(id);
      setRows((items) => items.map((item) => readIds.has(notificationId(item)) ? { ...item, is_read: true } : item));
      setAlert((item) => item && readIds.has(notificationId(item)) ? null : item);
    };
    void refresh();
    const poll = setInterval(() => void refresh(), 5000);
    window.addEventListener("focus", refresh);
    window.addEventListener("notifications:refresh", refresh);
    window.addEventListener("notifications:read", onRead);
    return () => {
      active = false;
      clearInterval(poll);
      if (alertTimer) clearTimeout(alertTimer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("notifications:refresh", refresh);
      window.removeEventListener("notifications:read", onRead);
    };
  }, [role, account]);
  return { unreadCount: rows.filter(isUnreadNotification).length, alert, dismissAlert };
}
