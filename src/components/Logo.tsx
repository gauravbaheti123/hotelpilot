export function Logo({ size = 36 }: { size?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-md bg-primary text-primary-foreground font-bold"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-label="HotelPilot"
    >
      HP
    </div>
  );
}