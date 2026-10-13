import Link from "next/link";
import { Wordmark } from "./brand";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/#how", label: "How it works" },
      { href: "/#plans", label: "Plans" },
      { href: "/login", label: "Live demo" },
    ],
  },
  {
    title: "Account",
    links: [
      { href: "/login", label: "Sign in" },
      { href: "/signup", label: "Create a workspace" },
    ],
  },
];

/** The public site's footer: who we are, where to go next, and the small print. */
export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-paper-deep">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-12 sm:grid-cols-[1.5fr_1fr_1fr]">
        <div>
          <Wordmark size={32} />
          <p className="mt-3 max-w-xs text-[15px] text-ink-soft">The control layer for AI agents: see, control and approve what every agent does.</p>
        </div>
        {COLUMNS.map((c) => (
          <nav key={c.title} aria-label={c.title}>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink">{c.title}</h2>
            <ul className="mt-3 space-y-2">
              {c.links.map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="text-[15px] text-ink-soft hover:text-himal-700 hover:underline">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-6xl px-5 py-4 text-sm text-ink-muted">© 2026 AgentGuard. AgentGuard is a working name.</p>
      </div>
    </footer>
  );
}
