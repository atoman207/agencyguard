import Link from "next/link";
import type { ReactNode } from "react";
import { Eye, Hand, OctagonX } from "@/components/icons";
import { Wordmark } from "@/components/brand";

const POINTS = [
  { icon: Eye, text: "One live log of every action, reply and cost" },
  { icon: Hand, text: "Risky actions wait for a person you trust" },
  { icon: OctagonX, text: "One switch stops any agent everywhere" },
];

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto grid min-h-screen w-full max-w-[1440px] lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <aside className="hidden min-w-0 flex-col border-r border-line bg-white lg:flex">
          <div className="px-10 py-10 xl:px-16">
            <Link href="/" aria-label="AgentGuard home">
              <Wordmark size={40} />
            </Link>
          </div>
          <div className="min-w-0 flex-1 px-10 pb-10 xl:px-16">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-simrik-600">Namaste</p>
            <h1 className="mt-3 max-w-md text-balance text-[2.1rem] font-semibold leading-[1.15] text-himal-900">Every AI agent. Under control.</h1>
            <p className="mt-4 max-w-md text-pretty text-[17px] leading-relaxed text-ink-soft">See what your agents do, decide what they may do, and approve what matters, across every platform they run on.</p>
            <ul className="mt-8 max-w-md space-y-4 text-[15px] text-ink">
              {POINTS.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-himal-50 text-himal-700">
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0 pt-1.5 leading-snug">{text}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
        <main className="flex min-w-0 flex-col bg-white">
          <div className="border-b border-line px-6 py-4 lg:hidden">
            <Link href="/" aria-label="AgentGuard home">
              <Wordmark />
            </Link>
          </div>
          <div className="flex flex-1 items-center justify-center px-5 py-10">
            <div className="w-full max-w-sm">{children}</div>
          </div>
        </main>
      </div>
    </div>
  );
}
