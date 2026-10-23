import { createFileRoute } from "@tanstack/react-router";
import { SimpleWarehouseModule } from "./inventory";

export const Route = createFileRoute("/warehouse-dashboard")({
  head: () => ({
    meta: [
      { title: "Warehouse Control Center · KaizenAssests" },
      {
        name: "description",
        content: "Authoritative operational warehouse dashboard.",
      },
    ],
  }),
  component: WarehouseDashboard,
});

function WarehouseDashboard() {
  return <SimpleWarehouseModule />;
}
