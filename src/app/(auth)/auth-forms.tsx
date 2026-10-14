"use client";

import { useId, useState } from "react";
import { loginAction, signupAction } from "@/app/actions";
import { Eye, EyeOff } from "@/components/icons";
import { ActionForm, SubmitButton } from "@/components/forms";

function PasswordField({
  id,
  name,
  autoComplete,
  label,
  hint,
  minLength,
  required = true,
}: {
  id: string;
  name: string;
  autoComplete: string;
  label: string;
  hint?: string;
  minLength?: number;
  required?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
          minLength={minLength}
          required={required}
          className="field pr-11"
        />
        <button
          type="button"
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-ink-muted hover:text-ink"
          aria-label={show ? "Hide password" : "Show password"}
          aria-pressed={show}
          onClick={() => setShow((v) => !v)}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}

export function LoginForm() {
  const pwdId = useId();
  return (
    <ActionForm action={loginAction} className="space-y-4">
      <div>
        <label className="field-label" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required className="field" />
      </div>
      <PasswordField id={pwdId} name="password" autoComplete="current-password" label="Password" />
      <SubmitButton className="w-full">Sign in</SubmitButton>
    </ActionForm>
  );
}

export function SignupForm() {
  const pwdId = useId();
  const confirmId = useId();
  const [preview, setPreview] = useState<string | null>(null);

  return (
    <ActionForm action={signupAction} encType="multipart/form-data" className="space-y-4">
      <div>
        <label className="field-label" htmlFor="avatar">Avatar</label>
        <div className="flex items-center gap-3">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-paper-deep ring-1 ring-line">
            {preview ? <img src={preview} alt="" className="h-full w-full object-cover" /> : <span className="text-xs font-medium text-ink-muted">Photo</span>}
          </span>
          <input
            id="avatar"
            name="avatar"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="field file:mr-3 file:rounded-md file:border-0 file:bg-himal-50 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-himal-800"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) {
                setPreview(null);
                return;
              }
              const url = URL.createObjectURL(file);
              setPreview((prev) => {
                if (prev) URL.revokeObjectURL(prev);
                return url;
              });
            }}
          />
        </div>
        <p className="field-hint">Optional. JPEG, PNG, WebP or GIF, up to 2 MB.</p>
      </div>
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
      <PasswordField id={pwdId} name="password" autoComplete="new-password" label="Password" hint="At least 8 characters." minLength={8} />
      <PasswordField id={confirmId} name="password_confirm" autoComplete="new-password" label="Confirm password" minLength={8} />
      <SubmitButton className="w-full">Create workspace</SubmitButton>
    </ActionForm>
  );
}
