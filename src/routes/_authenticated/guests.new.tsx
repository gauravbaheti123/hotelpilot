import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/guests/new")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});