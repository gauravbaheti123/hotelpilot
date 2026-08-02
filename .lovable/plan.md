## Confirmed diagnosis

1. **Tiny physical fragment:** `src/lib/qzPrint.ts` passes `pageWidth: 80` for an 80mm ticket. QZ’s HTML pixel renderer interprets this render width as **80 inches**, not 80mm. The printer driver then reduces that 80-inch canvas onto an 80mm roll—approximately **3.94% scale**, matching the tiny mostly-blank fragment in the photograph. The HTML is not empty: recent live KOTs contain multiple valid item rows, including notes.
2. **Reprint does not fire at the counter:** `KotHistoryDialog` uses a different printer lookup from fresh KOTs. It selects one property-wide printer filtered by `type IN ('kot','both')`, while fresh prints route each item through its Food Menu item/category station assignment. Existing station printers can therefore print fresh KOTs but be skipped on Reprint; Reprint then falls into the unreliable hidden browser-dialog fallback.
3. **Current warnings:** item-level/category-level assignments now resolve for the recently punched menu items inspected (for example, items route to `RESTKITCHEN` or `FASTFOOD`). The warning must continue to list the exact item names whenever any future item has no resolved station.

## Implementation

1. **Correct the common QZ thermal pipeline**
   - Convert physical paper width from millimetres to inches before assigning `data.options.pageWidth` (`80mm → 3.1496`, `58mm → 2.2835`).
   - Omit `pageHeight` for HTML so QZ auto-sizes ticket length from actual content.
   - Keep the existing native printer density, thermal 1:1 scaling, 2mm margins, 76mm/54mm content widths, and bottom feed block.
   - Extend the existing QZ diagnostic log to include the final render width in inches, HTML byte count, item-row count, target printer, and resolved config.

2. **Make Reprint use the same routing as fresh KOT**
   - Resolve each historical Food item through `menu_items.kitchen_printer_id`, falling back to `menu_categories.kot_printer_id`.
   - Load all active property printers without the divergent `type` filter.
   - Rebuild station jobs with `buildKotPrintPlan(..., "kitchen")` and dispatch with `runKotPrintJobs`, preserving multi-station behavior.
   - Do not print a new counter copy from the kitchen-only Reprint action.
   - Preserve the Laundry fallback path, which does not have Food Menu station assignments.
   - Show a success toast naming the printer(s), and a hard error if no station job can be formed instead of silently appearing to do nothing.

3. **Verification before completion claim**
   - Run the relevant type/build validation and verify generated HTML contains the expected ticket/item rows.
   - Verify both fresh KOT and Reprint reach the shared QZ call with `pageWidth ≈ 3.1496` for 80mm, never `80`.
   - Verify an unassigned item warning names the exact item rather than only saying “1 item(s).”

## Required physical-printer acceptance test

This cannot be honestly declared physically fixed from the sandbox. After implementation, perform both tests on the same real 80mm station printer:

1. **Fresh Print KOT:** punch a KOT containing at least two items, one long item name, and one instruction note. Photograph the full ticket beside a ruler. Expected: content spans roughly the 76mm printable width, readable bold text, no tiny top-corner fragment, all items present, and bottom feed before the cut.
2. **View KOT → Reprint:** reprint that exact punch. Expected: the assigned kitchen station printer feeds a second ticket without opening a browser print dialog; layout and physical text size match the fresh ticket.

Capture the QZ console `[qz/print-job]` entry with each photograph. It should show the intended printer, non-zero HTML bytes/item rows, and `renderPageWidthInches` near `3.1496`.