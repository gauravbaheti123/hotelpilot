# Bill To company/GST booking me bhara hai, par bill par nahi aata — fix

## Kya ho raha hai

Booking BK-20260920-0003 me aapne Bill To me company (DHANRAJ SOLVEX PRIVATE LIMITED,
GSTIN 27AAECD9033H1ZM) select ki thi — woh booking par sahi save hui hai.

Lekin us booking ka bill (folio) bante waqt company ki koi detail copy hi nahi hoti:
bill par Bill To khali "Guest (individual)" reh jata hai aur Guest GSTIN blank.
Isi wajah se invoice ke Bill To block me sirf guest ka naam chhapta hai — GSTIN,
company name aur address nahi.

Yeh sirf ek booking ka issue nahi: abhi is property me **38 bills** aise hain jinki
booking par company hai par bill par nahi (inme se 5 abhi open hain).

## Kya theek karenge

1. **Bill banate hi company aa jaye** — jab booking ka bill pehli baar bane, booking
   ki Bill To company (naam, GSTIN, address/state) apne aap bill par set ho jayegi.
   Guest ka apna GSTIN tab bhi bill par aayega jab koi company nahi hai.

2. **Purane khule bills** — jo bills abhi khule hain aur jinki booking par company hai,
   unhe kholne par company apne aap lag jayegi (staff ko dobara select nahi karna padega).
   Finalise ho chuke bills ki rakam/GST ko haath nahi lagayenge — unka Bill To pehle se
   maujood Owner/Manager correction se badla ja sakta hai.

3. **Ek baar ka data fix (aapki manzoori ke baad)** — 38 purane bills me se sirf un par
   company set karenge jo abhi settle nahi hue. Jo settle/invoice ho chuke hain, unki
   list aapko doonga — aap bataenge to unhe manually correct karenge, taki GST breakup
   (CGST/SGST vs IGST) galat na badle.

Screen ka design, layout ya permissions me koi badlav nahi.

## Technical notes

- Root cause: `public.get_or_create_folio(_booking_id)` naya folio sirf
  `property_id, booking_id, created_by` ke saath insert karta hai —
  `billing_company_id`, `guest_company`, `guest_gstin` kabhi booking se copy nahi hote.
  Invoice ka Bill To block (`invoiceTemplates.ts` ~297-312) aur folio page ka
  `billToCompany` (`billing.folio.$bookingId.tsx` ~224-236) folio ke fields hi padhte
  hain, isliye khali dikhta hai.
- Migration: `get_or_create_folio` ke INSERT me booking → `billing_companies` join se
  `billing_company_id`, `guest_company` (company name), `guest_gstin` seed karo.
  SECURITY DEFINER, search_path public — signature aur grants jaisi hain waisi hi.
- Client backfill: folio page ke `load()` me, agar `folio.billing_company_id` null hai,
  `folio.billing_guest_id` null hai, folio open hai, aur `booking.billing_company_id`
  set hai → wahi patch lagao jo `updateBillTo()` lagata hai (company name, GSTIN) aur
  `resolveTaxType` se place of supply dobara nikaalo. Finalised folios chhod do.
- Backfill script sirf `status='open'` folios par; settled/void ko report karke chhodna.
- Koi schema change nahi, koi RBAC change nahi.
