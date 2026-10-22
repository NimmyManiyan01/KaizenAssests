import { createFileRoute, redirect } from "@tanstack/react-router";
import { requireRole } from "@/lib/auth-utils";

export const Route = createFileRoute("/warehouse/assembly-requisitions")({
  beforeLoad: () => {
    requireRole(["WAREHOUSE", "WAREHOUSE_MANAGER", "ADMIN", "SUPERUSER"]);
    throw redirect({ to: "/inventory", search: { tab: "picking" } });
  },
});
