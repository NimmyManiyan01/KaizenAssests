import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";
import { requireRole } from "@/lib/auth-utils";

export const Route = createFileRoute("/supplier/asns")({
  beforeLoad: ({ location }) => {
    requireRole(["SUPPLIER", "ADMIN", "SUPERUSER"]);
    if (location.pathname === "/supplier/asns" || location.pathname === "/supplier/asns/") {
      throw redirect({ to: "/supplier/asns/new", search: { open: undefined } });
    }
  },
  component: Outlet,
});
