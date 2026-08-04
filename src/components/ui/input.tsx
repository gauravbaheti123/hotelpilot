import * as React from "react";

import { cn } from "@/lib/utils";
import { titleCase } from "@/lib/indiaGeo";

export interface InputProps extends React.ComponentProps<"input"> {
  /**
   * Phase 73 — opt-in Title Casing for name/address-type fields.
   * Applies titleCase() on blur only (never per keystroke), then fires the
   * normal onChange so controlled forms pick up the normalised value.
   * Never enable this for email, GSTIN, mobile, ID numbers, passwords,
   * reference/bill numbers, HSN or free-text notes.
   */
  autoTitleCase?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, autoTitleCase, onBlur, onChange, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        onChange={onChange}
        onBlur={(e) => {
          if (autoTitleCase) {
            const next = titleCase(e.target.value ?? "");
            if (next !== e.target.value) {
              e.target.value = next;
              onChange?.({
                ...e,
                target: e.target,
                currentTarget: e.currentTarget,
                type: "change",
              } as unknown as React.ChangeEvent<HTMLInputElement>);
            }
          }
          onBlur?.(e);
        }}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
