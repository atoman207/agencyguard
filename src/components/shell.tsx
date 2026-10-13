"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import {
  Bot, FlaskConical, Gauge, Hand, KeyRound, LayoutDashboard, ListChecks, Menu, MessageSquareWarning, Plug, Radar, ScrollText, Settings, ShieldCheck, Wrench, X,
} from "@/components/icons";
import { Wordmark } from "./brand";

interface Item {
  href: string;
  label: string;
  icon: typeof Bot;
  badge?: boolean;
}

// The groups follow the product's own stages: see, control, enforce, prove.
const NAV: { title: string | null; items: Item[] }[] = [
  { title: null, items: [{ href: "/overview", label: "Overview", icon: LayoutDashboard }] },
  {
    title: "See",
    items: [
      { href: "/agents", label: "Agents", icon: Bot },
      { href: "/activity", label: "Activity", icon: ScrollText },
      { href: "/coverage", label: "Coverage", icon: Radar },
    ],
  },
  {
    title: "Control",
    items: [
      { href: "/approvals", label: "Approvals", icon: Hand, badge: true },
      { href: "/rules", label: "Rules", icon: ListChecks },
      { href: "/limits", label: "Limits & budgets", icon: Gauge },
      { href: "/tools", label: "Tools", icon: Wrench },
      { href: "/responses", label: "Responses", icon: MessageSquareWarning },
    ],
  },
  {
    title: "Enforce",
    items: [
      { href: "/vault", label: "Vault & gateways", icon: KeyRound },
      { href: "/connect", label: "Connect an agent", icon: Plug },
    ],
  },
  {
    title: "Prove",
    items: [{ href: "/audit", label: "Audit trail", icon: ShieldCheck }],
  },
  {
    title: null,
    items: [
      { href: "/playground", label: "Playground", icon: FlaskConical },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

function NavList({ pathname, badge, onNavigate }: { pathname: string | null; badge: ReactNode; onNavigate?: () => void }) {
  return (
    <nav className="space-y-4" aria-label="Main">
      {NAV.map((group, i) => (
        <div key={i}>
          {group.title && <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">{group.title}</div>}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = !!pathname && (pathname === item.href || pathname.startsWith(`${item.href}/`));
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[15px] font-medium transition ${
                      active ? "bg-himal-50 text-himal-800" : "text-ink-soft hover:bg-paper-deep hover:text-ink"
                    }`}
                  >
                    {active && <span className="absolute inset-y-1.5 left-0 w-1 rounded-r bg-himal-600" />}
                    <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? "text-himal-700" : "text-ink-muted group-hover:text-ink-soft"}`} />
                    <span className="flex-1">{item.label}</span>
                    {item.badge && badge}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function ActiveNav(props: { badge: ReactNode; onNavigate?: () => void }) {
  return <NavList pathname={usePathname()} {...props} />;
}

export function Sidebar({ badge, footer }: { badge: ReactNode; footer: ReactNode }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      {/* phone and tablet: a top bar with a menu button */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-white px-4 py-3 lg:hidden">
        <Link href="/overview" aria-label="AgentGuard overview">
          <Wordmark size={30} />
        </Link>
        <button type="button" onClick={() => setOpen(true)} className="rounded-lg p-2 text-ink-soft hover:bg-paper-deep" aria-label="Open menu">
          <Menu className="h-5 w-5" />
        </button>
      </div>
      {open && <button type="button" aria-label="Close menu" className="fixed inset-0 z-40 bg-ink/30 lg:hidden" onClick={close} />}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col overflow-hidden border-r border-line bg-white transition-transform duration-200 lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex items-center justify-between px-5 pb-4 pt-5">
          <Link href="/overview" onClick={close} aria-label="AgentGuard overview">
            <Wordmark />
          </Link>
          <button type="button" onClick={close} className="rounded-lg p-1.5 text-ink-soft hover:bg-paper-deep lg:hidden" aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="relative z-10 flex-1 overflow-y-auto px-3 py-4">
          {/* usePathname cannot resolve while a dynamic route is prerendered, so the list first renders without an active item. */}
          <Suspense fallback={<NavList pathname={null} badge={badge} onNavigate={close} />}>
            <ActiveNav badge={badge} onNavigate={close} />
          </Suspense>
        </div>
        <div className="relative z-10 border-t border-line bg-white p-3">{footer}</div>
      </aside>
    </>
  );
}
