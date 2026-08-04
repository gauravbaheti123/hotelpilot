// Part 4 — Step 6: custom remark, highlighted at checkout.
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  value: string;
  onChange: (next: string) => void;
}

export function StepRemarks({ value, onChange }: Props) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Custom remark</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Shown as a highlighted warning banner to whoever checks this guest out.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="wizard-custom-remark">Custom remark (highlighted at checkout)</Label>
        <Textarea
          id="wizard-custom-remark"
          rows={4}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. Collect balance in cash at checkout"
        />
      </div>
    </div>
  );
}
