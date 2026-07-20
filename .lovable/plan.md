## Findings

| Area | Status | Details |
|---|---|---|
| Guest CRM route code | Warning | `src/routes/_authenticated/guests.index.tsx` already calls `.limit(15500)` for the main guest list. |
| Current guest count | Pass | The database currently has 2,943 guest rows total, so there should be more than 1,000 available if permissions/property scope allow them. |
| Likely cause | Fail | The backend API has a default/max row cap of 1,000 per request. A single `.limit(15500)` request can still return only 1,000 unless the client paginates/ranges the results. |

## Plan

1. Update the Guest CRM list loader to fetch guests in pages using `.range(from, to)` chunks, accumulating rows until fewer than the page size is returned or 15,500 rows are reached.
2. Keep the same columns, ordering, property scoping, filters, search, and UI layout exactly as-is.
3. Apply the same paginated helper to Guest CSV export if needed, so export is not capped by the same 1,000-row limit.
4. Add basic error handling so a failed page fetch shows a toast instead of silently showing a partial list.
5. Verify with a read-only count/query and code inspection that the Guest CRM can load beyond 1,000 rows without changing permissions or design.