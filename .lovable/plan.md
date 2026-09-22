# Checkout atak raha hai — "Select an early-checkout billing option first"

## Kya ho raha hai

Room 202 (Nishigandha Bhavke) 21 Sept se 23 Sept tak booked hai, par guest aaj
22 Sept ko ja raha hai — yani ek din pehle. Uska bill pehle hi poora bhar chuka
hai (Invoice 2133, ₹6,694 total, ₹6,694 paid).

Aise settled bill par Checkout Summary sirf "₹0 due — ready to close" dikhata
hai. Lekin andar ka niyam kehta hai: "guest jaldi ja raha hai, pehle batao
kitni raat charge karni hai". Woh sawaal is screen par kahin dikhta hi nahi,
isliye "Confirm Checkout" dabate hi laal message aata hai aur checkout kabhi
hota nahi — dead end.

## Kya theek karenge

Settled bill wale checkout screen par bhi wahi "Early checkout — choose
billing" box dikhega, do option ke saath:

1. **Poori booked stay charge karein (2 raat)** — bill jaisa hai waisa hi
   rahega, turant checkout ho jayega.
2. **Sirf actual stay charge karein (1 raat)** — bill kam ho jayega, aur jo
   extra paisa guest ne de diya hai wo "extra jama" ke roop me dikhega; wahin
   se refund ya doosre bill me transfer ho sakega (ye flow pehle se bana hua
   hai).

Option chunte hi totals turant refresh honge, aur "Confirm Checkout" chalu ho
jayega. Baaki screen ka design waisa hi rahega.

## Technical notes

- `src/components/CheckoutDialog.tsx`: `settledZero` branch (≈1098-1129) me
  wahi `early` card render karein jo normal branch (≈1166-1214) me hai — ek
  chhote `EarlyChoiceCard` sub-component me nikaal kar dono jagah use karenge,
  taki markup duplicate na ho.
- `applyEarlyChoice("actual_stay")` booking_rooms + bookings ka `check_out`
  chhota karke `load()` karta hai; settled folio par isse `paid > total` ho
  jayega. Ye already-implemented excess/refund path se handle hota hai
  (`excessAmount` in `src/lib/billing.ts`, folio page ka excess banner).
  Choice apply hone ke baad `settledZero` dobara compute ho — load() ke baad
  folio refresh se ye apne aap hota hai.
- `collectAndCheckout` ka guard (line 683) waisa hi rahega; ab option screen
  par maujood hone se guard pehunch me aa jayega.
- Activity log `EARLY_CHECKOUT_CHOICE` waise hi likhta rahega.
- Koi schema change nahi, koi RBAC change nahi, koi layout redesign nahi.
