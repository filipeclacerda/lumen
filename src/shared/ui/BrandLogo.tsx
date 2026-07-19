import logoUrl from "../../../src-tauri/icons/icon.png";

export function BrandLogo({
  size = 40,
  className = "",
  decorative = false,
}: {
  size?: number;
  className?: string;
  decorative?: boolean;
}) {
  return (
    <img
      className={`brand-logo ${className}`.trim()}
      src={logoUrl}
      width={size}
      height={size}
      alt={decorative ? "" : "Logo do Lumen"}
      aria-hidden={decorative || undefined}
    />
  );
}
