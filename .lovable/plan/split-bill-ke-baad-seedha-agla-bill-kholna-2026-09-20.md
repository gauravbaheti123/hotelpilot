# Split bill ke baad seedha agla bill kholna

## Problem
Jab ek booking par split bill ho (2+ bills) aur ek bill settle ho jaye, to user ko wapas jaake doosra bill dhoondhna/kholna padta hai. Chaahiye: settle ke turant baad agle unsettled bill par jaane ka option.

## Current state (verified)
- `src/routes/_authenticated/billing.folio.$bookingId.tsx` — `settle()` (~line 1824) settle ke baad sirf `toast.success` + `load()` karta hai; koi next-bill option nahi.
- Split bills ek hi booking ke sibling folios hote hain (`parent_folio_id` set); `FolioOpenButton.tsx` inhe picker me dikhata hai, lekin bill screen ke andar se switch karne ka rasta nahi.

## Changes

### 1. Bill screen par sibling-bill bar (`billing.folio.$bookingId.tsx`)
- `load()` me ek extra query: same booking ke saare non-deleted, non-void folios (`id, invoice_number, status, total_amount, balance_amount`) — `booking_id` match, current folio ko chhodkar.
- Agar 1+ sibling ho, bill ke header ke paas chhota "Bills on this booking" strip: har bill ka number + status (Open/Settled) + due amount; click karne par usi page par `?folio=<id>` ke saath navigate (route pehle se support karta hai — FolioOpenButton wahi karta hai).
- Koi design/layout change nahi — ek compact row of chips, existing tokens.

### 2. Settle hone par "next bill" offer (`settle()`)
- Settle success ke baad unsettled sibling folios check kare (status open/due, balance > 0).
- Agar milte hain: toast ke bajaye ek chhota dialog — "Bill <number> settled. Agla bill kholein?" — saare bache hue bills buttons ke roop me (number + due amount), plus "Wapas raho / Done" button jo current behavior (reload) kare.
- Button click → `/billing/folio/$bookingId?folio=<nextId>` par navigate.
- Koi unsettled sibling nahi to current behavior unchanged (toast + reload).

## Out of scope
- Food/Laundry segment bills ka flow (alag screen) — sirf lodge folio split bills.
- Koi database/RPC change nahi — sirf existing folio reads.

## Verification
- Build log clean.
- Flow test: booking par bill split → bill A settle → dialog me bill B dikhe → click par bill B khule; sibling bar dono bills dikhaye.
