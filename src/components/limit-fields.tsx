import { ACTIONS } from "@/lib/catalog";
import type { Agent, Limit } from "@/lib/types";

/** Shared create/edit fields for a spending limit. */
export function LimitFields({ agents, limit }: { agents: Pick<Agent, "id" | "name">[]; limit?: Limit }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div className="sm:col-span-2">
        <label className="field-label" htmlFor={limit ? `limit-name-${limit.id}` : "limit-name"}>Name</label>
        <input id={limit ? `limit-name-${limit.id}` : "limit-name"} name="name" className="field" placeholder="Refunds per customer per week" required defaultValue={limit?.name} />
      </div>
      <div>
        <label className="field-label" htmlFor={limit ? `limit-kind-${limit.id}` : "limit-kind"}>What to limit</label>
        <select id={limit ? `limit-kind-${limit.id}` : "limit-kind"} name="kind" className="field" defaultValue={limit?.kind ?? "money"}>
          <option value="money">Business money</option>
          <option value="cost">AI-model cost (USD)</option>
          <option value="count">Number of actions</option>
        </select>
      </div>
      <div>
        <label className="field-label" htmlFor={limit ? `limit-value-${limit.id}` : "limit-value"}>Limit</label>
        <input id={limit ? `limit-value-${limit.id}` : "limit-value"} name="value" type="number" min="0" step="any" className="field" placeholder="150" required defaultValue={limit?.value} />
      </div>
      <div>
        <label className="field-label" htmlFor={limit ? `limit-scope-${limit.id}` : "limit-scope"}>Counted per</label>
        <select id={limit ? `limit-scope-${limit.id}` : "limit-scope"} name="scope" className="field" defaultValue={limit?.scope ?? "customer"}>
          <option value="action">Single action</option>
          <option value="customer">Customer</option>
          <option value="resource">Resource (order, charge, record)</option>
          <option value="agent">Agent</option>
          <option value="organization">Whole organization</option>
        </select>
      </div>
      <div>
        <label className="field-label" htmlFor={limit ? `limit-period-${limit.id}` : "limit-period"}>Over</label>
        <select id={limit ? `limit-period-${limit.id}` : "limit-period"} name="period" className="field" defaultValue={limit?.period === "action" ? "day" : (limit?.period ?? "week")}>
          <option value="hour">Any hour</option>
          <option value="day">Any 24 hours</option>
          <option value="week">Any 7 days</option>
          <option value="month">Any 30 days</option>
        </select>
        <p className="field-hint">Ignored for single-action limits.</p>
      </div>
      <div>
        <label className="field-label" htmlFor={limit ? `limit-action-${limit.id}` : "limit-action"}>Action type</label>
        <select id={limit ? `limit-action-${limit.id}` : "limit-action"} name="action" className="field" defaultValue={limit?.action ?? "payment.refund"}>
          <option value="">Any</option>
          <option value="payment.*">All payments</option>
          {ACTIONS.filter((a) => a.id !== "ai.completion").map((a) => (
            <option key={a.id} value={a.id}>{a.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="field-label" htmlFor={limit ? `limit-agent-${limit.id}` : "limit-agent"}>Agent</label>
        <select id={limit ? `limit-agent-${limit.id}` : "limit-agent"} name="agent" className="field" defaultValue={limit?.agent_id ?? ""}>
          <option value="">Every agent</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className="field-label" htmlFor={limit ? `limit-exceed-${limit.id}` : "limit-exceed"}>When the limit is reached</label>
        <select id={limit ? `limit-exceed-${limit.id}` : "limit-exceed"} name="on_exceed" className="field" defaultValue={limit?.on_exceed ?? "ask_human"}>
          <option value="ask_human">Ask a person</option>
          <option value="block">Block</option>
        </select>
        <p className="field-hint">AI-cost budgets always block: there is nothing to approve once the budget is spent.</p>
      </div>
    </div>
  );
}
