"use client";

import { useState, type ReactNode } from "react";
import { Ban, Check, Hand } from "@/components/icons";

// Chart colours. The three decision colours were checked with a colour-blind
// simulation (adjacent pairs stay distinct). Marigold is below 3:1 contrast on
// white, so the chart always ships a legend with labels and a table view.
const SERIES = [
  { key: "allowed", label: "Allowed", color: "#1b8a4b", icon: <Check className="h-3.5 w-3.5" /> },
  { key: "asked", label: "Needed a person", color: "#e89a00", icon: <Hand className="h-3.5 w-3.5" /> },
  { key: "blocked", label: "Blocked", color: "#dc143c", icon: <Ban className="h-3.5 w-3.5" /> },
] as const;

export interface DecisionDay {
  key: string;
  label: string;
  allowed: number;
  asked: number;
  blocked: number;
}

function niceMax(value: number): number {
  if (value <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(value));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= value) return m * pow;
  return 10 * pow;
}

/** Decisions per day, stacked. One tooltip per column lists every series. */
export function DecisionColumns({ days }: { days: DecisionDay[] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = niceMax(Math.max(1, ...days.map((d) => d.allowed + d.asked + d.blocked)));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(t * max));
  const plotHeight = 176;

  return (
    <figure>
      <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-ink-soft">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />
            {s.icon}
            {s.label}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <div className="relative w-7 shrink-0 text-right text-[11px] tabular-nums text-ink-muted" style={{ height: plotHeight }}>
          {ticks.map((t, i) => (
            <span key={i} className="absolute right-0 -translate-y-1/2" style={{ top: plotHeight - (i / 4) * plotHeight }}>
              {t}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative" style={{ height: plotHeight }} onMouseLeave={() => setActive(null)}>
            {ticks.map((_, i) => (
              <span key={i} className={`absolute inset-x-0 h-px ${i === 0 ? "bg-line-strong" : "bg-line"}`} style={{ top: plotHeight - (i / 4) * plotHeight }} />
            ))}
            <div className="absolute inset-0 flex items-end">
              {days.map((d, i) => {
                const total = d.allowed + d.asked + d.blocked;
                const present = SERIES.filter((s) => d[s.key] > 0);
                return (
                  <button
                    key={d.key}
                    type="button"
                    aria-label={`${d.label}: ${d.allowed} allowed, ${d.asked} needed a person, ${d.blocked} blocked`}
                    className={`relative flex h-full flex-1 cursor-default items-end justify-center rounded-sm outline-none transition-colors focus-visible:bg-himal-50 ${active === i ? "bg-paper-deep/60" : ""}`}
                    onMouseEnter={() => setActive(i)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                  >
                    {/* Reversed so "allowed" sits on the baseline and "blocked" on top. */}
                    <span className="flex w-full max-w-6 flex-col-reverse gap-0.5" style={{ height: `${(total / max) * 100}%` }}>
                      {present.map((s, j) => (
                        <span key={s.key} className={j === present.length - 1 ? "rounded-t" : ""} style={{ background: s.color, flexGrow: d[s.key], flexBasis: 0, minHeight: 2 }} />
                      ))}
                    </span>
                    {active === i && (
                      <span className={`pointer-events-none absolute bottom-full z-10 mb-1 w-44 rounded-lg border border-line bg-white p-2.5 text-left shadow-lift ${i > days.length / 2 ? "right-0" : "left-0"}`}>
                        <span className="block text-xs font-semibold text-ink-muted">{d.label}</span>
                        {SERIES.map((s) => (
                          <span key={s.key} className="mt-1 flex items-center justify-between gap-3 text-[13px] text-ink-soft">
                            <span className="flex items-center gap-1.5">
                              <span className="h-0.5 w-3 rounded" style={{ background: s.color }} />
                              {s.label}
                            </span>
                            <strong className="tabular-nums text-ink">{d[s.key]}</strong>
                          </span>
                        ))}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mt-1.5 flex text-[11px] text-ink-muted">
            {days.map((d) => (
              <span key={d.key} className="flex-1 text-center">
                {d.label}
              </span>
            ))}
          </div>
        </div>
      </div>
      <details className="mt-3 text-[13px]">
        <summary className="cursor-pointer select-none font-medium text-himal-700 hover:underline">Show as a table</summary>
        <table className="mt-2 w-full text-left tabular-nums">
          <thead>
            <tr className="text-ink-muted">
              <th className="py-1 font-medium">Day</th>
              {SERIES.map((s) => (
                <th key={s.key} className="py-1 text-right font-medium">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.key} className="border-t border-line">
                <td className="py-1">{d.label}</td>
                {SERIES.map((s) => (
                  <td key={s.key} className="py-1 text-right">
                    {d[s.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/** A small trend line: earlier points recede, the latest point carries the accent. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const w = 96;
  const h = 28;
  const max = Math.max(...values, 1e-9);
  const pts = values.map((v, i) => [4 + (i / (values.length - 1)) * (w - 8), h - 4 - (v / max) * (h - 8)] as const);
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} className="shrink-0">
      <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="#b9ae9c" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r="4" fill="#003893" stroke="#ffffff" strokeWidth="2" />
    </svg>
  );
}

export function StatTile({ label, value, note, icon, trend, tone = "plain" }: { label: string; value: ReactNode; note?: ReactNode; icon?: ReactNode; trend?: ReactNode; tone?: "plain" | "attention" }) {
  return (
    <div className={`rounded-xl border bg-card p-4 shadow-card ${tone === "attention" ? "border-marigold-300 ring-1 ring-marigold-200" : "border-line"}`}>
      <div className="flex items-center justify-between gap-2 text-sm font-medium text-ink-muted">
        <span>{label}</span>
        {icon}
      </div>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <div className="font-display text-[1.75rem] font-semibold leading-none text-himal-900">{value}</div>
        {trend}
      </div>
      {note && <div className="mt-2 text-[13px] leading-snug text-ink-muted">{note}</div>}
    </div>
  );
}

// Protection level is an ordered scale, so it uses one hue: deep blue for
// enforced, light blue for cooperative, and the bare track for what is not covered.
const LEVELS = [
  { key: "enforced", label: "Enforced", color: "#003893" },
  { key: "cooperative", label: "Cooperative", color: "#7fa6e6" },
  { key: "uncovered", label: "Not covered", color: "#e2d8c8" },
] as const;

export function CoverageBar({ share, compact }: { share: { enforced: number; cooperative: number; uncovered: number; tools: number }; compact?: boolean }) {
  if (share.tools === 0) return <p className="text-sm text-ink-muted">No tools seen yet.</p>;
  return (
    <div>
      <div className={`flex gap-0.5 overflow-hidden rounded-full ${compact ? "h-2" : "h-3"}`} role="img" aria-label={`${share.enforced}% enforced, ${share.cooperative}% cooperative, ${share.uncovered}% not covered`}>
        {LEVELS.map((l) => share[l.key] > 0 && <span key={l.key} style={{ width: `${share[l.key]}%`, background: l.color }} />)}
      </div>
      {!compact && (
        <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-ink-soft">
          {LEVELS.map((l) => (
            <li key={l.key} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[3px] ring-1 ring-inset ring-black/5" style={{ background: l.color }} />
              {l.label}
              <strong className="tabular-nums text-ink">{share[l.key]}%</strong>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Horizontal bars for one measure across named items. One series, so one colour and no legend. */
export function HBars({ rows }: { rows: { label: string; value: number; display: string }[] }) {
  const max = Math.max(...rows.map((r) => r.value), 1e-9);
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate text-ink-soft" title={r.label}>
            {r.label}
          </span>
          <span className="h-3">
            <span className="block h-full rounded-r" style={{ width: `${Math.max((r.value / max) * 100, r.value > 0 ? 1.5 : 0)}%`, background: "#2a62c9" }} />
          </span>
          <span className="tabular-nums font-medium text-ink">{r.display}</span>
        </li>
      ))}
    </ul>
  );
}
