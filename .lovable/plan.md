# Advance more than the bill — refund / adjust at settlement

## Problem

Guest ne advance zyada de diya aur final bill kam ban gaya (jaldi checkout, night kam, discount). Aaj bill screen par:

- Payment box zyada rakam lene se rokta hai (sahi hai), par **pehle se liya hua extra advance** kahin handle nahi hota.
- Balance `Math.max(0, total - paid)` se dikhta hai, yaani extra rakam **chhup jaati hai** — na screen par, na invoice par.
- Aaj database me aise 7 bills hain jinme jama rakam bill se zyada hai (1 abhi khula hua, sabse bada farq ₹10,502).

Refund ka koi option system me hai hi nahi.

## Kya banega

### 1. Extra rakam saaf dikhegi

Bill screen par jab jama rakam bill se zyada ho, ek patti dikhegi:
**"Advance excess ₹X — guest ko wapas karna hai"**, do buttons ke saath: **Refund** aur **Doosre bill me lagayein**.

### 2. Refund

"Refund" par ek chhota dialog: rakam (default = poora extra, kam bhi kar sakte hain), mode (Cash / UPI / Card / NEFT), reference no., reason (zaroori).
Save hone par bill me ek **Refund line** judegi (rakam minus me), jama rakam ghat jayegi, balance ₹0 ho jayega aur bill settle ho payega.
Payments list me ye line "REFUND" chip ke saath alag rang me dikhegi.

### 3. Doosre bill me lagayein (split bills ke liye)

Agar usi booking par doosra bill baaki hai, to extra rakam ek click me us bill par transfer ho jayegi — is bill par refund line, doosre bill par payment line, dono ek saath.

### 4. Settle ke waqt rok

Jab tak extra rakam refund ya transfer na ho, "Settle" dabane par message aayega: "Bill se ₹X zyada jama hai — pehle refund ya transfer karein." (Owner chahe to "Refund later" chunke aage badh sakta hai, jisse bill `due` ki jagah settled ho par excess note ho.)

### 5. Invoice aur reports

- Invoice ke payment section me Refund line dikhegi aur "Net Received" sahi aayega.
- Daily / payment reports me refund alag ginaa jayega (collection me se minus), taaki cash tally sahi rahe.

### 6. Purane 7 bills

Report banakar dikhaunga (booking no., guest, bill no., extra rakam). Aapki haan ke baad hi unpar refund/adjust entry karunga — settle ho chuke bills ka GST breakup nahi chhedunga.

## Technical notes

- Refund = `payments` row with **negative `amount`**, `mode` = chosen mode, plus `notes` prefix `REFUND — <reason>`. `payments` par koi positive-amount constraint nahi hai, isliye schema change ki zaroorat nahi. (Agar saaf flag chahiye to `entry_type` column add kar sakte hain — abhi notes-prefix + negative amount se kaam chal jayega, isliye zero migration.)
- `settlementPaidTotal` / `realPaidTotal` (`src/lib/billing.ts`) already sum karte hain, negative rows apne aap ghatenge; `overpaymentError` unchanged.
- Naya helper `excessAmount(total, payments)` in `src/lib/billing.ts`; balance display `Math.max(0, …)` ke saath excess alag field.
- UI sirf `billing.folio.$bookingId.tsx` me: excess banner, `RefundDialog`, transfer action (sibling folios pehle se `siblingFolios` state me hain).
- Permission: refund `can("payments", "delete")` (owner/manager) ke under; har refund `logActivity` me `PAYMENT_REFUNDED` ke saath log hoga.
- Transfer atomically ek RPC se karunga (`transfer_folio_credit(_from, _to, _amount, _reason)`, SECURITY DEFINER, revoke anon, grant authenticated/service_role) taaki aadha-adhura na ho.
- Invoice template (`invoiceTemplates.ts`) me payments loop negative rows ko "Refund" label ke saath render karega.
