"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, useState, type ComponentProps, type FormEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Check, CircleAlert, Copy, LoaderCircle } from "@/components/icons";
import { buttonClass } from "./ui";

export type ActionState = { ok: boolean; message?: string; data?: Record<string, unknown> } | null;
export type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

/** True while the enclosing form's action is running. Read by SubmitButton. */
export const PendingContext = createContext(false);

/**
 * Submits a form to an action without letting React clear its fields.
 *
 * React resets every uncontrolled field once a form action finishes, even when
 * the action reports an error, so a rejected form would come back empty. Calling
 * the action ourselves keeps what the person typed. The submitter is passed to
 * FormData so a clicked button's name and value are included.
 */
export function submitTo(action: (form: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(event.currentTarget, submitter);
    startTransition(() => action(data));
  };
}

/**
 * A form bound to a Server Action. Shows the action's success or error message
 * inline, and can render extra content from the action's result.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
  result,
  quiet,
  encType,
}: {
  action: FormAction;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  /** Renders below the form when the action succeeded with data. */
  result?: (data: Record<string, unknown>) => ReactNode;
  /** Hide the success message; errors always show. */
  quiet?: boolean;
  encType?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form ref={ref} action={formAction} onSubmit={submitTo(formAction)} className={className} encType={encType}>
      <PendingContext value={pending}>{children}</PendingContext>
      {state && !state.ok && state.message && (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-simrik-200 bg-simrik-50 px-3 py-2 text-sm font-medium text-simrik-800">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {state.message}
        </p>
      )}
      {state?.ok && state.message && !quiet && (
        <p role="status" className="mt-3 flex items-start gap-2 rounded-lg border border-terai-200 bg-terai-50 px-3 py-2 text-sm font-medium text-terai-700">
          <Check className="mt-0.5 h-4 w-4 shrink-0" />
          {state.message}
        </p>
      )}
      {state?.ok && state.data && result?.(state.data)}
    </form>
  );
}

type ButtonProps = ComponentProps<"button"> & {
  variant?: Parameters<typeof buttonClass>[0];
  size?: Parameters<typeof buttonClass>[1];
  /** Ask the person to confirm before the form is submitted. */
  confirm?: string;
};

export function SubmitButton({ children, variant, size, className, confirm, disabled, onClick, ...props }: ButtonProps) {
  // `useFormStatus` covers forms submitted natively; the context covers `submitTo`.
  const status = useFormStatus();
  const pending = useContext(PendingContext) || status.pending;
  return (
    <button
      {...props}
      type="submit"
      disabled={pending || disabled}
      className={buttonClass(variant, size, className)}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
        onClick?.(e);
      }}
    >
      {pending && <LoaderCircle className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={buttonClass("secondary", "sm")}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-terai-600" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : label}
    </button>
  );
}

/** A secret shown exactly once, with a copy button. */
export function OneTimeSecret({ value, note }: { value: string; note: string }) {
  return (
    <div className="mt-3 rounded-xl border border-marigold-300 bg-marigold-50 p-3">
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg bg-white px-3 py-2 text-[13px] text-ink ring-1 ring-marigold-200">{value}</code>
        <CopyButton text={value} />
      </div>
      <p className="mt-2 text-[13px] font-medium text-marigold-900">{note}</p>
    </div>
  );
}
