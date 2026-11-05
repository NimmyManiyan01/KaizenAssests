import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/warehouse/finished-goods-requests")({
  beforeLoad: () => {
    throw redirect({
      to: "/inventory",
      search: { tab: "finished-goods" },
      replace: true,
    });
  },
});
