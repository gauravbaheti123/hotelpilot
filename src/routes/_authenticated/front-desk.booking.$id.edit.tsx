// Standalone edit route — kept for deep links and bookmarks. The unified
// booking page (/front-desk/booking/$id) hosts the same wizard inline.
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { BackButton } from "@/components/BackButton";
import { RequirePermission } from "@/components/RequirePermission";
import { BookingEditWizard } from "@/components/booking-wizard/BookingEditWizard";

export const Route = createFileRoute("/_authenticated/front-desk/booking/$id/edit")({
  head: () => ({ meta: [{ title: "Edit Booking — HotelPilot" }] }),
  component: () => (
    <RequirePermission module="bookings" action="edit">
      <EditBookingPage />
    </RequirePermission>
  ),
});

function EditBookingPage() {
  const { id } = Route.useParams();
  const router = useRouter();
  const back = () => router.navigate({ to: "/front-desk/booking/$id", params: { id } });

  return (
    <AppShell title="Edit booking">
      <div className="max-w-4xl space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <BackButton fallbackTo="/front-desk/bookings" />
          <p className="text-sm text-muted-foreground">
            Guest details, stay dates, room, tariff, Bill To and remarks. Taxes and payments are
            still changed from the booking page.
          </p>
        </div>
        <BookingEditWizard bookingId={id} onSaved={back} onCancel={back} />
      </div>
    </AppShell>
  );
}
