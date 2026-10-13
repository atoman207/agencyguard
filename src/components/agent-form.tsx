import { ActionForm, SubmitButton, type FormAction } from "./forms";
import { PLATFORMS } from "@/lib/platforms";
import type { Agent, User } from "@/lib/types";

export function AgentForm({ action, agent, users, defaultMode, submit }: { action: FormAction; agent?: Agent; users: User[]; defaultMode: string; submit: string }) {
  return (
    <ActionForm action={action} className="space-y-5">
      {agent && <input type="hidden" name="id" value={agent.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="field-label" htmlFor="name">Name</label>
          <input id="name" name="name" className="field" defaultValue={agent?.name} placeholder="Support bot" required />
        </div>
        <div>
          <label className="field-label" htmlFor="platform">Built with</label>
          <select id="platform" name="platform" className="field" defaultValue={agent?.platform ?? "n8n"}>
            {PLATFORMS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="field-label" htmlFor="purpose">Purpose</label>
        <input id="purpose" name="purpose" className="field" defaultValue={agent?.purpose} placeholder="Answers customers and issues refunds" />
        <p className="field-hint">One line on what this agent is for. Approvers see it next to every request.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="field-label" htmlFor="owner">Responsible person</label>
          <select id="owner" name="owner" className="field" defaultValue={agent?.owner_user_id ?? users[0]?.id}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="environment">Environment</label>
          <select id="environment" name="environment" className="field" defaultValue={agent?.environment ?? "production"}>
            <option value="production">Production</option>
            <option value="staging">Staging</option>
            <option value="development">Development</option>
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="mode">Mode</label>
          <select id="mode" name="mode" className="field" defaultValue={agent?.mode ?? defaultMode}>
            <option value="observe">Observe: record, block nothing</option>
            <option value="enforce">Enforce: apply rules</option>
          </select>
        </div>
      </div>
      <fieldset className="space-y-2.5 rounded-xl border border-line bg-paper/60 p-4">
        <label className="flex items-start gap-3 text-[15px]">
          <input type="checkbox" name="handles_private_data" defaultChecked={!!agent?.handles_private_data} className="mt-1 h-4 w-4 accent-himal-700" />
          <span>
            <span className="font-semibold">Can reach private data</span>
            <span className="block text-sm text-ink-muted">Customer records, orders, inboxes. If it has also read untrusted content, anything it sends outside will need a person.</span>
          </span>
        </label>
        <label className="flex items-start gap-3 text-[15px]">
          <input type="checkbox" name="check_responses" defaultChecked={agent ? !!agent.check_responses : true} className="mt-1 h-4 w-4 accent-himal-700" />
          <span>
            <span className="font-semibold">Check its replies</span>
            <span className="block text-sm text-ink-muted">Run the response checkpoint on what it says through the AI-model gateway. Adds a little delay.</span>
          </span>
        </label>
      </fieldset>
      <SubmitButton>{submit}</SubmitButton>
    </ActionForm>
  );
}
