import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/warehouse/materials")({
  beforeLoad: () => {
    throw redirect({
      to: "/inventory",
      search: { tab: "materials" },
      replace: true,
    });
  },
});
