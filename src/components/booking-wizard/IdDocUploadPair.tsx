// Two-slot ID document capture: front and back. Both optional.
// Reuses the existing single-slot IdDocUpload (Drive upload + thumbnail).
import { IdDocUpload, type UploadedIdDoc } from "@/components/booking-wizard/IdDocUpload";

export interface IdDocPairValue {
  front: UploadedIdDoc;
  back: UploadedIdDoc;
}

interface Props {
  value: IdDocPairValue;
  onChange: (next: IdDocPairValue) => void;
  guestName?: string;
  disabled?: boolean;
}

export function IdDocUploadPair({ value, onChange, guestName, disabled }: Props) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold">ID Document (optional)</div>
      <div className="grid gap-4 sm:grid-cols-2">
        <IdDocUpload
          label="ID Front"
          side="front"
          guestName={guestName}
          disabled={disabled}
          value={value.front}
          onChange={(front) => onChange({ ...value, front })}
        />
        <IdDocUpload
          label="ID Back"
          side="back"
          guestName={guestName}
          disabled={disabled}
          value={value.back}
          onChange={(back) => onChange({ ...value, back })}
        />
      </div>
    </div>
  );
}
