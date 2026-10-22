export type NotificationRecord = { id?: string; notification_id?: string; is_read?: boolean; isRead?: boolean; created_at?: string; title?: string; message?: string; body?: string; [key: string]: any };
export const notificationId = (item: NotificationRecord) => String(item.id || item.notification_id || "");
export const isUnreadNotification = (item: NotificationRecord) => !(item.is_read ?? item.isRead ?? false);
export function uniqueNotifications(items: NotificationRecord[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = notificationId(item);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export async function acknowledgeVisibleNotifications(items: NotificationRecord[], markRead: (id: string) => Promise<unknown>) {
  const unread = uniqueNotifications(items).filter(isUnreadNotification);
  await Promise.all(unread.map((item) => markRead(notificationId(item))));
  if (unread.length) window.dispatchEvent(new CustomEvent("notifications:read", { detail: unread.map(notificationId) }));
  return items.map((item) => ({ ...item, is_read: true }));
}
