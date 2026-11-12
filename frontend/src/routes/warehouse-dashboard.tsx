import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/warehouse-dashboard")({
  beforeLoad: () => {
    throw redirect({
      to: "/inventory",
      search: { tab: "dashboard" },
      replace: true,
    });
  },
});
