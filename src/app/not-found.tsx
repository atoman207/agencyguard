import Link from "next/link";
import { Wordmark } from "@/components/brand";
import { buttonClass } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="lokta flex min-h-screen flex-col items-center justify-center px-5 text-center">
      <Wordmark size={40} />
      <h1 className="mt-8 text-3xl font-semibold text-himal-900">This page does not exist</h1>
      <p className="mt-2 max-w-md text-ink-soft">The link may be old, or the item may belong to another workspace.</p>
      <Link href="/overview" className={buttonClass("primary", "md", "mt-6")}>
        Back to the overview
      </Link>
    </main>
  );
}
