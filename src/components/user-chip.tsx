import Image from "next/image";
import Link from "next/link";
import { avatarForUser } from "@/lib/avatar";
import type { Role } from "@/lib/types";

export function UserChip({
  user,
  href = "/overview",
  size = 36,
  subtitle,
}: {
  user: { name: string; role: Role; email?: string; avatar?: string | null };
  href?: string | null;
  size?: number;
  subtitle?: string;
}) {
  const src = avatarForUser(user);
  const isDataUrl = src.startsWith("data:");
  const avatarClass = "shrink-0 rounded-full object-cover ring-2 ring-white";
  const avatarStyle = { width: size, height: size };
  const chip = (
    <span className="inline-flex min-w-0 items-center gap-2.5">
      {isDataUrl ? (
        // next/image does not allow data URLs without a custom loader.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={size} height={size} className={avatarClass} style={avatarStyle} />
      ) : (
        <Image src={src} alt="" width={size} height={size} className={avatarClass} style={avatarStyle} />
      )}
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-sm font-semibold text-ink">{user.name}</span>
        {subtitle ? <span className="block truncate text-xs text-ink-muted">{subtitle}</span> : null}
      </span>
    </span>
  );

  if (!href) return chip;
  return (
    <Link href={href} className="rounded-lg outline-offset-2 transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-himal-500">
      {chip}
    </Link>
  );
}
