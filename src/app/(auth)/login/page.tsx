import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "../auth-forms";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="rise w-full">
      <h1 className="text-[1.7rem] font-semibold text-himal-900">Sign in</h1>
      <p className="mb-6 mt-1 text-ink-soft">Welcome back to your control center.</p>
      <LoginForm />
      <p className="mt-6 text-center text-sm text-ink-muted">
        New here?{" "}
        <Link href="/signup" className="font-semibold text-himal-700 hover:underline">
          Create a workspace
        </Link>
      </p>
    </div>
  );
}
