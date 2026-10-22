import { expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: any) => ({ options }) }));
vi.mock("@/components/wms/app-shell", () => ({ AppShell: ({ children, actions }: any) => <main>{actions}{children}</main>, DockAllocationNotificationCard: () => null }));
vi.mock("@/lib/auth-utils", () => ({ getUserInfo: () => ({ username: "supplier", roles: ["SUPPLIER"] }) }));
vi.mock("@/lib/api-client", () => ({ api: {
  getNotifications: vi.fn().mockResolvedValue([{ id: "notice-1", title: "Delivery update", message: "Your shipment was received.", is_read: false, created_at: "2026-10-21T12:00:00" }]),
  markNotificationRead: vi.fn().mockResolvedValue({ success: true }),
} }));
import { Route } from "@/routes/notifications";
import { api } from "@/lib/api-client";

it("marks displayed notifications read immediately when opening the center", async () => {
  const read = vi.fn();
  window.addEventListener("notifications:read", read);
  try {
    const Page = Route.options.component as any;
    render(<Page />);
    expect(await screen.findByText("Delivery update")).toBeVisible();
    await waitFor(() => expect(api.markNotificationRead).toHaveBeenCalledWith("notice-1"));
    await waitFor(() => expect(read).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "Mark all as read" })).toBeDisabled();
  } finally { window.removeEventListener("notifications:read", read); }
});
