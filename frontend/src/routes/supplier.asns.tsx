import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { requireRole } from "@/lib/auth-utils";

const NewAsnPage = lazyRouteComponent(() => import("./supplier.asns.new"), "NewAsnPage");

export const Route = createFileRoute("/supplier/asns")({
  beforeLoad: () => requireRole(["SUPPLIER", "ADMIN", "SUPERUSER"]),
  component: NewAsnPage,
});
