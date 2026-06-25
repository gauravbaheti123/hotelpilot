import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/feedback/")({
  beforeLoad: () => {
    throw redirect({ to: "/guests" });
  },
});