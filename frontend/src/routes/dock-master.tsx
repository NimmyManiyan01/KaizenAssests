import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dock-master")({
  beforeLoad: () => {
    throw redirect({
      to: "/dock-management",
      replace: true,
    });
  },
});
