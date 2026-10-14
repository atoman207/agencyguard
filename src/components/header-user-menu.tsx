"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { LayoutDashboard, LogOut, User } from "@/components/icons";
import { logoutAction } from "@/app/actions";
import { UserChip } from "./user-chip";
import type { Role } from "@/lib/types";

export function HeaderUserMenu({
  user,
}: {
  user: { name: string; role: Role; email?: string; avatar?: string | null };
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="rounded-lg outline-offset-2 transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-himal-500"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        <UserChip user={user} href={null} size={36} />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          className="absolute right-0 z-[70] mt-2 w-56 overflow-hidden rounded-xl border border-line bg-white py-1 shadow-lift"
        >
          <div className="border-b border-line px-3 py-2.5">
            <p className="truncate text-sm font-semibold text-ink">{user.name}</p>
            {user.email ? <p className="truncate text-xs text-ink-muted">{user.email}</p> : null}
          </div>
          <Link
            href="/settings"
            role="menuitem"
            className="flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium text-ink hover:bg-paper-deep"
            onClick={() => setOpen(false)}
          >
            <User className="h-4 w-4 text-ink-muted" />
            Account management
          </Link>
          <Link
            href="/overview"
            role="menuitem"
            className="flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium text-ink hover:bg-paper-deep"
            onClick={() => setOpen(false)}
          >
            <LayoutDashboard className="h-4 w-4 text-ink-muted" />
            Admin panel
          </Link>
          <div className="my-1 border-t border-line" />
          <form action={logoutAction}>
            <button
              type="submit"
              role="menuitem"
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm font-medium text-simrik-700 hover:bg-simrik-50"
            >
              <LogOut className="h-4 w-4" />
              Log out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
