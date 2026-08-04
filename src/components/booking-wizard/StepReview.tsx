// Part 4 — Step 7: read-only preview of everything entered, plus submit.
import { Button } from "@/components/ui/button";
import { Pencil } from "lucide-react";
import { inr } from "@/lib/billing";
import { nightsBetween } from "@/lib/front-desk";
import { roomsTotal, STEP, type WizardState } from "@/lib/bookingWizard";
import { SOURCES } from "@/lib/front-desk";
import { ID_PROOF_LABELS } from "@/lib/guests";

const MEAL_PLAN_LABELS: Record<string, string> = {
  EP: "EP — Room only",
  CP: "CP — Breakfast",
  MAP: "MAP — Breakfast + 1 meal",
  AP: "AP — All meals",
};

const titleCase = (v: string) =>
  v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const sourceLabel = (v: string) =>
  SOURCES.find((s) => s.value === v)?.label ?? (v ? titleCase(v) : "");

const idTypeLabel = (v: string) =>
  (ID_PROOF_LABELS as Record<string, string>)[v] ?? (v ? titleCase(v) : "");

interface Props {
  state: WizardState;
  categoryName: (id: string) => string;
  roomLabel: (id: string) => string;
  onEdit: (step: number) => void;
}

function Section({
  title, step, onEdit, children,
}: { title: string; step: number; onEdit: (s: number) => void; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <h4 className="text-sm font-semibold">{title}</h4>
        <Button type="button" variant="ghost" size="sm" onClick={() => onEdit(step)}>
          <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
        </Button>
      </div>
      <div className="px-4 py-3 text-sm">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex gap-3 py-0.5">
      <span className="w-40 shrink-0 text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

export function StepReview({ state, categoryName, roomLabel, onEdit }: Props) {
  const total = roomsTotal(state.rooms);
  const advance = Number(state.payment.advance) || 0;
  const g = state.guest;

  return (
    <div className="space-y-4">
      <Section title="Booking type" step={STEP.TYPE} onEdit={onEdit}>
        <Row label="Type" value={state.kind === "lodge" ? "Lodge" : "Banquet"} />
        <Row label="Mode" value={state.reservation ? "Reservation (no check-in yet)" : "Walk-in / check-in"} />
        <Row label="Source" value={sourceLabel(state.source)} />
        {state.otaPartnerName && <Row label="OTA partner" value={state.otaPartnerName} />}
      </Section>

      <Section title="Primary guest" step={STEP.GUEST} onEdit={onEdit}>
        <Row label="Name" value={g.name} />
        <Row label="Mobile" value={g.mobile} />
        <Row label="Email" value={g.email} />
        <Row label="Nation" value={g.nation ? titleCase(g.nation) : ""} />
        <Row label="ID" value={g.idProofNumber ? `${idTypeLabel(g.idProofType)}: ${g.idProofNumber}` : g.passportNumber} />
        <Row label="Address" value={[g.address, g.city, g.state, g.pincode].filter(Boolean).join(", ")} />
        <Row label="Company" value={g.company} />
        <Row label="GSTIN" value={g.gstNumber} />
        <Row label="ID document" value={g.idDocFileId ? (g.idDocName ?? "Attached") : "Not attached"} />
      </Section>

      {!state.reservation && (
        <Section title="Guests" step={STEP.EXTRA_GUESTS} onEdit={onEdit}>
          <Row label="Adults" value={state.adults} />
          <Row label="Children" value={state.children} />
          {state.extraGuests.length > 0 && (
            <ul className="mt-2 space-y-1">
              {state.extraGuests.map((x) => (
                <li key={x.key} className="text-muted-foreground">
                  {x.name}
                  {x.relation ? ` · ${x.relation}` : ""}
                  {x.age ? ` · ${x.age} yrs` : ""}
                  {x.idProofNumber ? ` · ${x.idProofNumber}` : ""}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      <Section title="Stay & rooms" step={STEP.STAY} onEdit={onEdit}>
        <div className="space-y-3">
          {state.rooms.map((r, i) => {
            const n = nightsBetween(r.checkIn, r.checkOut);
            return (
              <div key={r.key} className="rounded-md bg-muted/40 px-3 py-2">
                <p className="font-medium">
                  Room {i + 1} — {categoryName(r.categoryId)}
                  {" · "}
                  {r.assignLater || !r.roomId ? "Assign later" : roomLabel(r.roomId)}
                </p>
                <p className="text-muted-foreground">
                  {r.checkIn} {r.checkInTime} → {r.checkOut} {r.checkOutTime} · {n} night{n === 1 ? "" : "s"}
                </p>
                <p className="text-muted-foreground">
                  {r.planName || "Plan"} · {MEAL_PLAN_LABELS[r.mealPlan] ?? r.mealPlan} ·{" "}
                  {inr(r.rate)}/night ({r.rateType === "inclusive" ? "Incl. GST" : "Excl. GST"}) ={" "}
                  <span className="font-medium text-foreground">{inr(n * (Number(r.rate) || 0))}</span>
                </p>
              </div>
            );
          })}
        </div>
      </Section>

      {!state.reservation && (
        <Section title="Bill to" step={STEP.BILL_TO} onEdit={onEdit}>
          {state.billTo.enabled ? (
            <>
              <Row label="Name" value={state.billTo.name} />
              <Row label="GSTIN" value={state.billTo.gstin} />
              <Row label="Address" value={state.billTo.address} />
              <Row label="Email" value={state.billTo.email} />
              <Row label="City" value={[state.billTo.city, state.billTo.state, state.billTo.nation].filter(Boolean).join(", ")} />
            </>
          ) : (
            <p className="text-muted-foreground">Billed to the primary guest.</p>
          )}
        </Section>
      )}

      <Section title="Payment" step={STEP.PAYMENT} onEdit={onEdit}>
        <Row label="Room total" value={inr(total)} />
        <Row label="Advance" value={`${inr(advance)}${advance > 0 ? ` (${titleCase(state.payment.mode ?? "")})` : ""}`} />
        <Row label="Balance" value={inr(Math.max(0, total - advance))} />
        <Row label="Notes" value={state.payment.notes} />
      </Section>

      <Section title="Custom remark" step={STEP.REMARKS} onEdit={onEdit}>
        {state.customRemark
          ? <p className="whitespace-pre-wrap">{state.customRemark}</p>
          : <p className="text-muted-foreground">None.</p>}
      </Section>
    </div>
  );
}
