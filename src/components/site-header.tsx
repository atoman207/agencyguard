import Link from "next/link";
import { HeaderUserMenu } from "./header-user-menu";
import { Wordmark } from "./brand";
import { buttonClass } from "./ui";
import { readShellSession } from "@/server/auth";

/**
 * Site header shown on marketing pages and inside the signed-in app.
 * Logo on the left; Log in or avatar menu on the right.
 */
export async function SiteHeader() {
  const session = await readShellSession();
  const user = session?.user ?? null;

  return (
    <header className="sticky top-0 z-[60] border-b border-line bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85">
      <nav className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-5 sm:px-8" aria-label="Main">
        <Link href={user ? "/overview" : "/"} aria-label="AgentGuard home">
          <Wordmark size={34} />
        </Link>

        {user ? (
          <HeaderUserMenu user={user} />
        ) : (
          <Link href="/login" className={buttonClass("primary", "md")}>
            Log in
          </Link>
        )}
      </nav>
    </header>
  );
}
