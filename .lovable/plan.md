# Open bill: restore Edit / Delete for Reception

## What's actually wrong

The buttons already exist in the bill screen — they are hidden because the reception role's rights are switched **off** in the database.

Checked the live rights table for the Receptionist role:

| Right | Current |
| --- | --- |
| Change payment mode | ON (this is why only "Mode" shows) |
| Edit payment amount | OFF |
| Edit payment date | OFF |
| Delete payment | OFF |
| Edit bill / charge lines | OFF |
| Delete charge lines | OFF |

So the earlier work was correct in the screen, but the rights rows were saved as "not allowed", so every button except "Mode" is hidden. Same for the room charge line — only the discount (%) icon shows because tariff edit and delete are off.

## The fix

1. Turn ON for the Receptionist role: edit payment amount, edit payment date, delete payment, edit invoice/charges, delete charge line.
2. Turn ON the same payment rights for Manager (currently only mode + date) so managers are never weaker than reception.
3. Leave Accounts / Housekeeping / Label Operator unchanged.
4. No change to the protections after checkout: a settled or finalised bill still needs Owner/Manager or the 60-minute grace window. Reception's new rights apply to open (pre-checkout) bills only, which is already how the screen gates them.
5. After the change, sign-in sessions pick up rights automatically (the screen already listens for rights changes); a page refresh will show the Edit / Date / Delete buttons on every payment row and Edit / Delete on every charge line.

## Technical notes

- Change is a data migration on `public.role_permissions`: set `allowed = true` for the Receptionist and Manager role ids on permissions `payments/edit_amount`, `payments/edit_date`, `payments/delete`, `invoices/edit`, `invoices/delete`.
- No UI code changes needed: `billing.folio.$bookingId.tsx` already renders Edit / Mode / Date / Delete for payments and Pencil / Trash for charge and night-split rows behind `canEditPaymentAmount`, `canEditPaymentDate`, `canDeletePayment`, `canEditTariff`, `canVoid`.
- Server-side RPCs (`delete_payment`, `change_payment_amount`, `change_payment_date`, `split_room_night`) already accept these permissions, so no function changes.
- Verification after applying: re-query the rights rows, then open the Room 304 provisional bill and confirm the duplicate ₹3,360 payment can be deleted.
