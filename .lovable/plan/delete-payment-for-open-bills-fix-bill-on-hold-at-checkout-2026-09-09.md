# Delete payment for open bills + fix "Bill On Hold" at checkout

## What I found

**1. Delete payment**
Reception already has the delete-payment right, but today the delete button
shows on *every* bill — including finalised/settled ones. The ask is the
opposite of what exists: allow it on open bills, block it on settled ones.

**2. "Bill On Hold" is treated two different ways**
- The database counts a Bill On Hold amount as paid, so the bill's balance
  drops to zero and the bill can close.
- The screens (bill screen, check-out box, split bill) *ignore* Bill On Hold
  when they add up what's paid, so check-out still says money is pending and
  refuses to finish.

That mismatch is the bug. It also explains the attached bill: because the
check-out screen didn't see the hold amount, a second Cash payment of the
same value was collected — the bill now shows ₹3,360 charged and ₹6,720 paid,
balance −₹3,360.

## What I will change

**Delete payment**
- Delete stays available on an open bill for anyone holding the right
  (Reception included).
- On a settled / due / void bill, delete is hidden for Reception and only
  stays available to Owner (or inside the existing 60-minute grace window
  right after settlement).
- The same rule is enforced on the server, not just hidden in the screen, so
  it can't be bypassed.

**Bill On Hold**
- One single rule everywhere: a Bill On Hold entry *does* clear the bill's
  balance and *does* let check-out complete — matching what the database
  already does.
- Check-out, the bill screen and split bill all use that same rule, so the
  balance shown, the balance saved and the check-out check always agree.
- Revenue and cash-collection figures (dashboard, daily report, dues report,
  hand-over) keep excluding Bill On Hold — it is still not real money.
- Because a hold now counts, the "you're collecting more than the balance"
  guard will also apply to it, so the double-count in the attached bill
  can't happen again.

**The bill in the screenshot**
- I'll check that booking's payments and, with your go-ahead, remove the
  duplicate entry so the bill shows ₹3,360 paid and zero balance. Tell me
  which of the two entries is the real one (Cash or the hold marker).

## Technical notes

- Bill screen: `src/routes/_authenticated/billing.folio.$bookingId.tsx`
  (`canDeletePayment`, `totals`, `persistTotals`, payment-collect guard).
- Shared helper `src/lib/billing.ts`: keep `realPaidTotal` for revenue
  reporting and add a settlement-side total that includes hold, used by the
  bill screen, `CheckoutDialog.tsx`, `SplitBillDialog.tsx`,
  `ChangePaymentModeDialog.tsx`.
- Server: `delete_payment` gains an open-bill/owner/grace check;
  `recompute_folio_totals` keeps its current hold-counts-as-paid behaviour
  (no change needed there).
- No visual/layout changes.
