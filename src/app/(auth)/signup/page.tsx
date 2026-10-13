import type { Metadata } from "next";
import Link from "next/link";
import { SignupForm } from "../auth-forms";

export const metadata: Metadata = { title: "Create a workspace" };

export default function SignupPage() {
  return (
    <div className="rise">
      <h1 className="text-[1.7rem] font-semibold text-himal-900">Create a workspace</h1>
      <p className="mb-6 mt-1 text-ink-soft">Connect your first agent in observe mode. Nothing is blocked until you say so.</p>
      <SignupForm />
      <p className="mt-6 text-center text-sm text-ink-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-himal-700 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
