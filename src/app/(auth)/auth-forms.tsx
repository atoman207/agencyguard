"use client";

import { loginAction, signupAction } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/forms";

export function LoginForm() {
  return (
    <ActionForm action={loginAction} className="space-y-4">
      <div>
        <label className="field-label" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required className="field" />
      </div>
      <div>
        <label className="field-label" htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="field" />
      </div>
      <SubmitButton className="w-full">Sign in</SubmitButton>
    </ActionForm>
  );
}

export function SignupForm() {
  return (
    <ActionForm action={signupAction} className="space-y-4">
      <div>
        <label className="field-label" htmlFor="organization">Workspace name</label>
        <input id="organization" name="organization" required className="field" placeholder="Your company or agency" />
      </div>
      <div>
        <label className="field-label" htmlFor="name">Your name</label>
        <input id="name" name="name" autoComplete="name" required className="field" />
      </div>
      <div>
        <label className="field-label" htmlFor="email">Work email</label>
        <input id="email" name="email" type="email" autoComplete="email" required className="field" />
      </div>
      <div>
        <label className="field-label" htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required className="field" />
        <p className="field-hint">At least 8 characters.</p>
      </div>
      <SubmitButton className="w-full">Create workspace</SubmitButton>
    </ActionForm>
  );
}
