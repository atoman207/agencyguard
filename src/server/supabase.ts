import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Supabase holds the shared template catalog (rule and limit packs). The app
// only ever reads it, and it does so with the publishable key: row-level
// security allows reads and nothing else. The secret key is not used by the
// running app at all; only `npm run supabase:seed` uses it, to write.

type Globals = typeof globalThis & { __agSupabase?: SupabaseClient };

export function supabaseConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}

/** A read-only client built from the publishable key. Throws if Supabase is not configured. */
export function supabase(): SupabaseClient {
  const g = globalThis as Globals;
  if (!g.__agSupabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error("Supabase is not configured.");
    g.__agSupabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5000), cache: "no-store" }) },
    });
  }
  return g.__agSupabase;
}
