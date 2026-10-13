"use client";

import { TriangleAlert } from "@/components/icons";
import { buttonClass } from "@/components/ui";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-simrik-200 bg-white p-8 text-center shadow-card">
      <TriangleAlert className="mx-auto h-9 w-9 text-simrik-500" />
      <h1 className="mt-3 text-xl font-semibold text-himal-900">This page could not be shown</h1>
      <p className="mt-2 text-[15px] text-ink-soft">{error.message || "Something went wrong while loading it."}</p>
      {error.digest && <p className="mt-1 text-xs text-ink-muted">Reference: {error.digest}</p>}
      <button type="button" onClick={reset} className={buttonClass("primary", "md", "mt-5")}>
        Try again
      </button>
    </div>
  );
}
