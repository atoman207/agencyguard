// Display formatting. Safe for client and server.

export function money(amount: number | null | undefined, currency: string | null | undefined = "usd"): string {
  if (amount === null || amount === undefined) return "—";
  const code = (currency || "usd").toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${code}`;
  }
}

/** AI cost is often fractions of a cent, so it keeps more precision than money. */
export function cost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 100) return `$${usd.toFixed(2)}`;
  return `$${Math.round(usd).toLocaleString("en-US")}`;
}

export function num(n: number): string {
  return n.toLocaleString("en-US");
}

export function compact(n: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function dateTime(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(ms);
}

export function fullDateTime(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone,
    timeZoneName: "short",
  }).format(ms);
}

export function longDate(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone }).format(ms);
}

export function hourIn(ms: number, timeZone: string): number {
  const h = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone }).format(ms);
  return Number(h) % 24;
}

export function relative(ms: number, now: number): string {
  const diff = ms - now;
  const abs = Math.abs(diff);
  const unit = (n: number, label: string) => {
    const v = Math.max(1, Math.round(n));
    return diff < 0 ? `${v}${label} ago` : `in ${v}${label}`;
  };
  if (abs < 45_000) return diff < 0 ? "just now" : "in a moment";
  if (abs < 3_600_000) return unit(abs / 60_000, "m");
  if (abs < 86_400_000) return unit(abs / 3_600_000, "h");
  return unit(abs / 86_400_000, "d");
}

export function titleCase(s: string): string {
  return s.replace(/[_.-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 12)}…` : id;
}

export function shortHash(hash: string): string {
  const h = hash.replace(/^sha256:/, "");
  return `${h.slice(0, 10)}…${h.slice(-6)}`;
}
