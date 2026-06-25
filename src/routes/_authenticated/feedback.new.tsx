import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/feedback/new")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});