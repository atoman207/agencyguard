"use client";

import { useState, type ReactNode } from "react";
import { Plus, Trash2 } from "@/components/icons";
import { updateSettingsAction } from "@/app/actions";
import { ActionForm, SubmitButton, type ActionState } from "./forms";
import type { ApprovedAnswer } from "@/lib/types";

function setPath(target: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split(".");
  let node = target;
  for (const key of keys.slice(0, -1)) node = (node[key] ??= {}) as Record<string, unknown>;
  node[keys[keys.length - 1]] = value;
}

/**
 * A settings form. Inputs named `s.<path>` are gathered into one partial
 * settings document, so each card on the page saves only its own fields.
 * A suffix sets the type: `#num`, `#bool`, `#list`, `#numOrNull`, `#prices`.
 */
export function SettingsForm({ children, className }: { children: ReactNode; className?: string }) {
  const action = async (state: ActionState, form: FormData): Promise<ActionState> => {
    const patch: Record<string, unknown> = {};
    for (const [name, raw] of form.entries()) {
      if (!name.startsWith("s.") || typeof raw !== "string") continue;
      const [path, type] = name.slice(2).split("#");
      // A checkbox posts a hidden "false" first and "true" after it when ticked; the later value wins.
      setPath(patch, path, parse(raw, type));
    }
    const out = new FormData();
    out.set("patch", JSON.stringify(patch));
    const name = form.get("org_name");
    if (typeof name === "string") out.set("org_name", name);
    return updateSettingsAction(state, out);
  };
  return (
    <ActionForm action={action} className={className}>
      {children}
    </ActionForm>
  );
}

function parse(raw: string, type: string | undefined): unknown {
  switch (type) {
    case "num":
      return Number(raw);
    case "bool":
      return raw === "true";
    case "numOrNull":
      return raw.trim() === "" ? null : Number(raw);
    case "list":
      return raw.split(/[\n,]/).map((v) => v.trim()).filter(Boolean);
    case "prices":
      // One model per line: name, input price, output price.
      return raw
        .split(/\n/)
        .map((line) => line.split(",").map((part) => part.trim()))
        .filter((parts) => parts[0])
        .map(([pattern, input, output]) => ({ pattern, inputPerM: Number(input), outputPerM: Number(output) }));
    default:
      return raw;
  }
}

export function Toggle({ name, defaultChecked, title, hint }: { name: string; defaultChecked: boolean; title: string; hint?: string }) {
  return (
    <label className="flex items-start gap-3 text-[15px]">
      <input type="hidden" name={`s.${name}#bool`} value="false" />
      <input type="checkbox" name={`s.${name}#bool`} value="true" defaultChecked={defaultChecked} className="mt-1 h-4 w-4 accent-himal-700" />
      <span>
        <span className="font-semibold">{title}</span>
        {hint && <span className="block text-sm text-ink-muted">{hint}</span>}
      </span>
    </label>
  );
}

/** Company-approved wording for sensitive topics. Saved as a whole list on every change. */
export function ApprovedAnswersEditor({ answers, canEdit }: { answers: ApprovedAnswer[]; canEdit: boolean }) {
  const [list, setList] = useState(answers);
  const [editingId, setEditingId] = useState<string | null>(null);

  const persist = async (next: ApprovedAnswer[]): Promise<ActionState> => {
    const out = new FormData();
    out.set("patch", JSON.stringify({ responseCheck: { approvedAnswers: next } }));
    const result = await updateSettingsAction(null, out);
    if (result?.ok) {
      setList(next);
      setEditingId(null);
    }
    return result;
  };

  const save = async (_: ActionState, form: FormData): Promise<ActionState> => {
    const removeId = form.get("remove");
    if (typeof removeId === "string" && removeId) {
      return persist(list.filter((a) => a.id !== removeId));
    }
    const editId = String(form.get("edit_id") ?? "").trim();
    const topic = String(form.get("topic") ?? "").trim();
    const answer = String(form.get("answer") ?? "").trim();
    const keywords = String(form.get("keywords") ?? "").split(",").map((k) => k.trim()).filter(Boolean);
    if (!topic || !answer || keywords.length === 0) {
      return { ok: false, message: "An approved answer needs a topic, at least one keyword and the answer text." };
    }
    if (editId) {
      return persist(list.map((a) => (a.id === editId ? { ...a, topic, keywords, answer } : a)));
    }
    const id = `ans_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    return persist([...list, { id, topic, keywords, answer }]);
  };

  return (
    <div>
      {list.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-muted">No approved answers yet. Without one, a reply set to replace is held for a person instead.</p>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((a) => (
            <li key={a.id} className="px-5 py-4">
              {editingId === a.id && canEdit ? (
                <ActionForm action={save} className="space-y-3">
                  <input type="hidden" name="edit_id" value={a.id} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="field-label" htmlFor={`edit-topic-${a.id}`}>Topic</label>
                      <input id={`edit-topic-${a.id}`} name="topic" className="field" defaultValue={a.topic} required />
                    </div>
                    <div>
                      <label className="field-label" htmlFor={`edit-keywords-${a.id}`}>Keywords, comma separated</label>
                      <input id={`edit-keywords-${a.id}`} name="keywords" className="field" defaultValue={a.keywords.join(", ")} required />
                    </div>
                  </div>
                  <div>
                    <label className="field-label" htmlFor={`edit-answer-${a.id}`}>Approved answer</label>
                    <textarea id={`edit-answer-${a.id}`} name="answer" rows={2} className="field" defaultValue={a.answer} required />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <SubmitButton size="sm">Save</SubmitButton>
                    <button type="button" className="inline-flex h-8 items-center rounded-md px-2.5 text-[13px] font-semibold text-ink-soft hover:bg-paper-deep" onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </div>
                </ActionForm>
              ) : (
                <div className="flex gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-ink">{a.topic}</div>
                    <div className="mt-0.5 text-[13px] text-ink-muted">Used when a flagged reply mentions: {a.keywords.join(", ")}</div>
                    <blockquote className="mt-2 rounded-lg border-l-4 border-terai-400 bg-terai-50 px-3 py-2 text-[15px] text-ink">{a.answer}</blockquote>
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0 items-start gap-1">
                      <button type="button" className="inline-flex h-8 items-center rounded-md px-2.5 text-[13px] font-semibold text-himal-700 hover:bg-himal-50" onClick={() => setEditingId(a.id)}>
                        Edit
                      </button>
                      <ActionForm action={save} quiet>
                        <input type="hidden" name="remove" value={a.id} />
                        <SubmitButton variant="ghost" size="sm" aria-label={`Remove ${a.topic}`} confirm={`Remove approved answer "${a.topic}"?`}>
                          <Trash2 className="h-4 w-4" />
                        </SubmitButton>
                      </ActionForm>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <ActionForm action={save} resetOnSuccess quiet className="border-t border-line p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="answer-topic">Topic</label>
              <input id="answer-topic" name="topic" className="field" placeholder="Delivery times" />
            </div>
            <div>
              <label className="field-label" htmlFor="answer-keywords">Keywords, comma separated</label>
              <input id="answer-keywords" name="keywords" className="field" placeholder="delivery, shipping, arrive" />
            </div>
          </div>
          <div className="mt-3">
            <label className="field-label" htmlFor="answer-text">Approved answer</label>
            <textarea id="answer-text" name="answer" rows={2} className="field" placeholder="Orders within Nepal arrive in 3 to 5 working days." />
          </div>
          <SubmitButton variant="secondary" className="mt-3">
            <Plus className="h-4 w-4" />
            Add approved answer
          </SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
