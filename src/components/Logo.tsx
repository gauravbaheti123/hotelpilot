import logoAsset from "@/assets/hotel-pilot-logo.png.asset.json";

export function Logo({ size = 36 }: { size?: number }) {
  return (
    <img
      src={logoAsset.url}
      alt="HotelPilot"
      width={size}
      height={size}
      className="rounded-md object-cover"
      style={{ width: size, height: size }}
    />
  );
}
