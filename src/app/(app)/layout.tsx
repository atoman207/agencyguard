import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { LogOut } from "@/components/icons";
import { logoutAction } from "@/app/actions";
import { Sidebar } from "@/components/shell";
import { SiteHeader } from "@/components/site-header";
import { UserChip } from "@/components/user-chip";
import { countPending } from "@/server/approvals";
import { readShellSession } from "@/server/auth";

// The layout itself reads nothing from the request, so it prerenders as a
// static shell. The parts that need the session stream in behind Suspense.

async function PendingBadge() {
  const session = await readShellSession();
  if (!session) return null;
  const n = countPending(session.org.id);
  if (!n) return null;
  return (
    <span className="pulse-dot rounded-full bg-marigold-500 px-1.5 text-xs font-bold leading-5 text-himal-950" aria-label={`${n} waiting`}>
      {n}
    </span>
  );
}

async function UserPanel() {
  const session = await readShellSession();
  if (!session) return null;
  const { user, org } = session;
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <UserChip user={user} href={null} size={36} subtitle={`${org.name} · ${user.role}`} />
      </div>
      <form action={logoutAction}>
        <button type="submit" className="rounded-lg p-2 text-ink-muted transition hover:bg-paper-deep hover:text-ink" aria-label="Sign out" title="Sign out">
          <LogOut className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <Suspense fallback={<header className="h-16 border-b border-line bg-white" />}>
        <SiteHeader />
      </Suspense>
      <div className="lg:pl-64">
        <Sidebar
          badge={
            <Suspense fallback={null}>
              <PendingBadge />
            </Suspense>
          }
          footer={
            <Suspense fallback={<div className="h-9" />}>
              <UserPanel />
            </Suspense>
          }
        />
        <div className="flex min-h-[calc(100vh-4rem)] flex-col bg-white">
          <main className="mx-auto w-full max-w-[1180px] flex-1 px-4 py-6 sm:px-8 sm:py-8">{children}</main>
          <footer className="border-t border-line bg-paper-deep">
            <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-4 text-sm text-ink-muted sm:px-8">
              <p>© 2026 AgentGuard</p>
              <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-1">
                <Link href="/connect" className="hover:text-himal-700 hover:underline">Connect an agent</Link>
                <Link href="/audit" className="hover:text-himal-700 hover:underline">Audit trail</Link>
                <Link href="/settings" className="hover:text-himal-700 hover:underline">Settings</Link>
              </nav>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
