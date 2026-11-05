import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/putaway-tasks")({
  beforeLoad: () => {
    throw redirect({
      to: "/inventory",
      replace: true,
    });
  },
});
