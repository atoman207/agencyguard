import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { Check, CircleAlert, Info, TriangleAlert } from "@/components/icons";

type Variant = "primary" | "secondary" | "danger" | "ghost" | "success";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-himal-700 text-white shadow-sm hover:bg-himal-800 active:bg-himal-900",
  secondary: "border border-line-strong bg-white text-ink shadow-sm hover:border-himal-300 hover:bg-himal-50",
  danger: "bg-simrik-500 text-white shadow-sm hover:bg-simrik-600 active:bg-simrik-700",
  success: "bg-terai-600 text-white shadow-sm hover:bg-terai-700",
  ghost: "text-ink-soft hover:bg-paper-deep hover:text-ink",
};
const SIZES: Record<Size, string> = { sm: "h-8 gap-1.5 rounded-md px-2.5 text-[13px]", md: "h-10 gap-2 rounded-lg px-4 text-[15px]" };

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra = ""): string {
  return `inline-flex shrink-0 items-center justify-center whitespace-nowrap font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${extra}`;
}

/** Prefer this over raw `<button className={buttonClass(...)}>`. Defaults to type="button". */
export function Button({ variant, size, className, type = "button", ...props }: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button type={type} {...props} className={buttonClass(variant, size, className)} />;
}

export function LinkButton({ variant, size, className, ...props }: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link {...props} className={buttonClass(variant, size, className)} />;
}

export function Card({ className = "", children, ...props }: ComponentProps<"section">) {
  return (
    <section {...props} className={`min-w-0 rounded-xl border border-line bg-card shadow-card ${className}`}>
      {children}
    </section>
  );
}

export function CardHeader({ title, hint, action, icon }: { title: ReactNode; hint?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div className="flex min-w-0 items-start gap-3">
        {icon && <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-himal-50 text-himal-700">{icon}</span>}
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {hint && <p className="mt-0.5 text-sm text-ink-muted">{hint}</p>}
        </div>
      </div>
      {action}
    </header>
  );
}

/** Page title. */
export function PageHeader({ title, lead, actions, eyebrow }: { title: ReactNode; lead?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 max-w-3xl">
          {eyebrow && <div className="mb-1 text-[13px] font-semibold uppercase tracking-wider text-himal-600">{eyebrow}</div>}
          <h1 className="text-[1.65rem] font-semibold leading-tight text-himal-900">{title}</h1>
          {lead && <p className="mt-1.5 text-[15px] text-ink-soft">{lead}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

type Tone = "neutral" | "good" | "warn" | "danger" | "info" | "dark";
const TONES: Record<Tone, string> = {
  neutral: "bg-paper-deep text-ink-soft ring-line-strong",
  good: "bg-terai-100 text-terai-600 ring-terai-200",
  warn: "bg-marigold-100 text-marigold-800 ring-marigold-200",
  danger: "bg-simrik-100 text-simrik-700 ring-simrik-200",
  info: "bg-himal-100 text-himal-700 ring-himal-200",
  dark: "bg-himal-900 text-white ring-himal-900",
};

export function Badge({ tone = "neutral", icon, children, className = "" }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[12.5px] font-semibold leading-5 ring-1 ring-inset ${TONES[tone]} ${className}`}>
      {icon}
      {children}
    </span>
  );
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {icon && <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-himal-50 text-himal-600">{icon}</div>}
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {body && <p className="mt-1 max-w-md text-sm text-ink-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <code className={`rounded bg-paper-deep px-1.5 py-0.5 text-[12.5px] text-ink-soft ${className}`}>{children}</code>;
}

/** A definition row: label on the left, value on the right. */
export function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-3 text-[15px] last:border-b-0">
      <dt className="shrink-0 text-ink-muted">{label}</dt>
      <dd className="min-w-0 text-right font-medium text-ink">{children}</dd>
    </div>
  );
}

const CALLOUT_ICONS = {
  info: Info,
  warn: TriangleAlert,
  danger: CircleAlert,
  good: Check,
} as const;

export function Callout({
  tone = "info",
  title,
  children,
  icon,
  role = "note",
}: {
  tone?: "info" | "warn" | "danger" | "good";
  title?: ReactNode;
  children: ReactNode;
  icon?: ReactNode | null;
  role?: "note" | "status" | "alert";
}) {
  const styles = {
    info: "border-himal-200 bg-himal-50 text-himal-900",
    warn: "border-marigold-200 bg-marigold-50 text-marigold-900",
    danger: "border-simrik-200 bg-simrik-50 text-simrik-800",
    good: "border-terai-200 bg-terai-50 text-terai-800",
  }[tone];
  const DefaultIcon = CALLOUT_ICONS[tone];
  const resolvedIcon = icon === null ? null : icon ?? <DefaultIcon className="h-5 w-5" />;
  return (
    <div role={role} className={`flex gap-3 rounded-xl border px-4 py-3 text-[15px] ${styles}`}>
      {resolvedIcon && <span className="mt-0.5 shrink-0" aria-hidden="true">{resolvedIcon}</span>}
      <div className="min-w-0">
        {title && <div className="font-semibold">{title}</div>}
        <div className={title ? "mt-0.5 opacity-90" : ""}>{children}</div>
      </div>
    </div>
  );
}

export function CodeBlock({ children, label }: { children: string; label?: string }) {
  return (
    <figure className="overflow-hidden rounded-xl border border-line bg-paper-deep">
      {label && <figcaption className="border-b border-line px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</figcaption>}
      <pre className="overflow-x-auto px-4 py-3 text-[13px] leading-relaxed text-ink">
        <code>{children}</code>
      </pre>
    </figure>
  );
}

export function Tabs({ tabs, current }: { tabs: { href: string; label: ReactNode; id: string; count?: number }[]; current: string }) {
  return (
    <nav className="mb-5 flex flex-wrap gap-1 border-b border-line" aria-label="Sections">
      {tabs.map((t) => (
        <Link
          key={t.id}
          href={t.href}
          aria-current={t.id === current ? "page" : undefined}
          className={`-mb-px flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-[15px] font-semibold transition ${
            t.id === current ? "border-himal-600 text-himal-900" : "border-transparent text-ink-muted hover:border-line-strong hover:text-ink"
          }`}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="rounded-full bg-marigold-200 px-1.5 text-xs font-bold text-marigold-900">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}
