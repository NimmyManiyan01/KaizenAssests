import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/warehouse/material-requests")({
  beforeLoad: () => {
    throw redirect({
      to: "/inventory",
      search: { tab: "requests" },
      replace: true,
    });
  },
});
