import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { RequirePermission } from "@/components/RequirePermission";
import { InvoiceListPanel } from "@/components/InvoiceListPanel";

export const Route = createFileRoute("/_authenticated/billing/invoices")({
  head: () => ({ meta: [{ title: "Invoices — HotelPilot" }] }),
  validateSearch: (search: Record<string, unknown>): { seg?: "lodge" | "food" | "laundry"; bill?: string } => ({
    seg: search.seg === "food" || search.seg === "laundry" || search.seg === "lodge" ? search.seg : undefined,
    bill: typeof search.bill === "string" && search.bill ? search.bill : undefined,
  }),
  component: InvoicesRoute,
});

function InvoicesRoute() {
  const { seg, bill } = Route.useSearch();
  return (
    <AppShell title="Invoices">
      <RequirePermission module="invoices">
        <InvoiceListPanel seg={seg} bill={bill} />
      </RequirePermission>
    </AppShell>
  );
}
