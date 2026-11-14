export type NotificationRecord = { id?: string; notification_id?: string; is_read?: boolean; isRead?: boolean; created_at?: string; title?: string; message?: string; body?: string; [key: string]: any };
export const notificationId = (item: NotificationRecord) => String(item.id || item.notification_id || "");
export const isUnreadNotification = (item: NotificationRecord) => !(item.is_read ?? item.isRead ?? false);

function dockAllocationKey(item: NotificationRecord): string | null {
  const title = String(item.title || "");
  const type = String(item.notification_type || item.type || "");
  if (!/dock\s+(?:allocation|allocated|confirmed)/i.test(`${title} ${type}`)) return null;

  const message = String(item.message || item.body || "");
  const gatePass = String(
    item.gate_pass_number ||
      item.gatePassNumber ||
      message.match(/Gate Pass(?:\s*:\s*|\s+)([^\n).]+)/i)?.[1] ||
      "",
  ).trim();
  const vehicle = String(
    item.vehicle_number ||
      item.vehicleNumber ||
      message.match(/vehicle(?:\s*:\s*|\s+)([^\n).]+)/i)?.[1] ||
      "",
  ).trim();
  const dock = String(
    item.dock_code ||
      item.dockCode ||
      message.match(/Dock Code:\s*([^\n]+)/i)?.[1] ||
      message.match(/Dock\s+([A-Z0-9_-]+)/i)?.[1] ||
      "",
  ).trim();

  if (!gatePass && !vehicle && !dock) return null;
  return `dock:${gatePass.toUpperCase()}:${vehicle.toUpperCase()}:${dock.toUpperCase()}`;
}

export function uniqueNotifications(items: NotificationRecord[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = notificationId(item);
    const key = dockAllocationKey(item) || id;
    if (!id || seen.has(key)) return false;
    seen.add(key);
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
