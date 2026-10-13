import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, Ban, Check, CircleDollarSign, Database, Eye, Gauge, Hand, KeyRound, Lock, Minus, MessageSquareWarning, OctagonX, ShieldQuestion, SlidersHorizontal } from "@/components/icons";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { buttonClass } from "@/components/ui";

const QUESTIONS = ["What are my agents doing?", "What are they allowed to do?", "What are they spending?", "Who approved that action?"];

const INCIDENTS = [
  { icon: Database, title: "Deleted production data", body: "An AI coding agent deleted a company's production database during a code freeze.", source: "Replit, 2025" },
  { icon: MessageSquareWarning, title: "Promised what wasn't true", body: "An airline chatbot invented a refund policy, and a tribunal made the airline honour it.", source: "Air Canada, 2024" },
  { icon: CircleDollarSign, title: "Spent without limits", body: "An agent stuck in a loop can call paid AI models thousands of times overnight.", source: "A common failure pattern" },
];

const FUNCTIONS = [
  { icon: Eye, name: "See", body: "Every action, reply and cost in one live log, with the rule that applied." },
  { icon: SlidersHorizontal, name: "Control", body: "Which tools and data each agent may use. Unknown tools ask first." },
  { icon: Gauge, name: "Limit", body: "Budgets for AI cost and real money, per action, per customer and over time." },
  { icon: Hand, name: "Approve", body: "Risky actions wait for a person. The approval is locked to the exact action." },
  { icon: OctagonX, name: "Stop", body: "One switch blocks an agent at every checkpoint and revokes its access." },
];

const REFUND = [
  "A customer asks the support agent for a $450 refund.",
  "The agent calls Stripe through AgentGuard. It never holds the real key.",
  "Rule: refunds above $100 need a manager.",
  "The manager sees the facts from Stripe first, then approves.",
  "The refund runs exactly once and is recorded.",
];

const JOURNEY = [
  ["Observe", "Connect agents in monitoring mode. Nothing is blocked."],
  ["Recommend", "AgentGuard suggests rules from real activity."],
  ["Control", "Switch on rules, budgets, approvals and reply checks."],
  ["Enforce", "Move money and irreversible actions to the vault and gateways."],
  ["Scale", "Reuse the same rules across every agent and client."],
];

type Cell = "yes" | "partial" | "no";
const COMPARE: [string, string, Cell[]][] = [
  ["Monitoring tools", "LangSmith, Langfuse, Helicone", ["yes", "no", "no", "partial", "yes"]],
  ["AI gateways & connector platforms", "Portkey, LiteLLM, Composio, Arcade", ["yes", "partial", "partial", "partial", "yes"]],
  ["Platform-native approvals", "n8n, Zapier, agent SDKs", ["no", "partial", "yes", "no", "yes"]],
  ["Enterprise AI security", "Zenity, Noma, Palo Alto, Check Point", ["yes", "yes", "partial", "partial", "no"]],
];

function Mark({ value }: { value: Cell }) {
  if (value === "yes") return <Check className="mx-auto h-5 w-5 text-terai-500" aria-label="Yes" />;
  if (value === "partial") return <span className="text-sm font-medium text-ink-muted">Partial</span>;
  return <Minus className="mx-auto h-5 w-5 text-line-strong" aria-label="No" />;
}

export default function LandingPage() {
  return (
    <div className="bg-white">
      {/* hero */}
      <Suspense fallback={<header className="h-16 border-b border-line bg-white" />}>
        <SiteHeader />
      </Suspense>
      <section className="border-b border-line bg-white">
        <div className="relative z-10 mx-auto grid max-w-6xl gap-10 px-5 pb-20 pt-10 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:pt-16">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-himal-600">The control layer for AI agents</p>
            <h1 className="mt-4 text-[2.6rem] text-himal-900 font-semibold leading-[1.08] sm:text-[3.4rem]">
              Every AI agent.
              <br />
              <span className="bg-gradient-to-r from-himal-600 to-cyan-500 bg-clip-text text-transparent">Under control.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-soft">
              See, control and approve what every agent does. One rule set, one budget and one audit trail across n8n, Make, LangChain, the OpenAI and Claude SDKs and your own code.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/login" className={buttonClass("primary", "md", "h-12 px-6 text-base")}>
                Open the live demo <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/signup" className="inline-flex h-12 items-center rounded-lg border border-line-strong px-6 text-base font-semibold text-ink transition hover:bg-paper-deep">Create a workspace</Link>
            </div>
            <p className="mt-4 text-sm text-ink-muted">Start in observe mode. Nothing is blocked until you say so.</p>
          </div>

          {/* a decision, as an approver sees it */}
          <div className="rise rounded-2xl border border-line bg-white p-5 text-ink shadow-lift">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-ink-muted">Support agent wants to</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-marigold-100 px-2.5 py-0.5 text-[13px] font-semibold text-marigold-800 ring-1 ring-inset ring-marigold-200">
                <Hand className="h-3.5 w-3.5" /> Ask a human
              </span>
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-3">
              <span className="font-display text-xl font-semibold text-himal-900">Refund a payment</span>
              <span className="font-display text-2xl font-semibold text-himal-900">$450</span>
            </div>
            <dl className="mt-4 space-y-2 rounded-xl bg-paper-deep p-3 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-ink-muted">Original charge</dt><dd className="font-medium">$450 — Order #5521</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-muted">Already refunded</dt><dd className="font-medium text-terai-700">Nothing yet</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-muted">Rule</dt><dd className="font-medium">Refunds above $100 need a manager</dd></div>
            </dl>
            <p className="mt-3 text-[13px] text-ink-muted">Facts come from Stripe, not from the agent. The approval is locked to this order and amount.</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <span className={buttonClass("secondary")}>Reject</span>
              <span className={buttonClass("success")}><Check className="h-4 w-4" />Approve</span>
            </div>
          </div>
        </div>
      </section>

      {/* the four questions */}
      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="max-w-2xl text-3xl font-semibold text-himal-900">AI agents now act on their own. Most companies cannot answer four simple questions about them.</h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {QUESTIONS.map((q, i) => (
              <li key={q} className="rounded-xl border border-line bg-white p-5 shadow-card">
                <span className="font-display text-sm font-semibold text-himal-500">0{i + 1}</span>
                <p className="mt-2 font-display text-lg font-semibold leading-snug text-himal-900">{q}</p>
              </li>
            ))}
          </ul>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {INCIDENTS.map(({ icon: Icon, title, body, source }) => (
              <article key={title} className="rounded-xl border border-simrik-100 bg-simrik-50/60 p-5">
                <Icon className="h-6 w-6 text-simrik-500" />
                <h3 className="mt-3 text-lg font-semibold text-himal-900">{title}</h3>
                <p className="mt-1 text-[15px] text-ink-soft">{body}</p>
                <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-simrik-700">{source}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* five functions */}
      <section className="border-y border-line bg-white">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <p className="text-sm font-semibold uppercase tracking-wider text-himal-600">One control layer for every agent</p>
          <h2 className="mt-2 text-3xl font-semibold text-himal-900">Connect your agents once. Then:</h2>
          <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
            {FUNCTIONS.map(({ icon: Icon, name, body }) => (
              <li key={name}>
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-himal-50 text-himal-700"><Icon className="h-6 w-6" /></span>
                <h3 className="mt-3 text-xl font-semibold text-himal-900">{name}</h3>
                <p className="mt-1 text-[15px] text-ink-soft">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* how it works */}
      <section id="how" className="scroll-mt-16 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="max-w-3xl text-3xl font-semibold text-himal-900">We don&apos;t control the agent. We control its actions.</h2>
          <p className="mt-3 max-w-3xl text-lg text-ink-soft">Every agent acts through AI models, tools and credentials. AgentGuard sits at those points, so one set of rules works whatever the agent is built with.</p>

          <div className="mt-10 grid items-stretch gap-4 lg:grid-cols-[1fr_auto_1.5fr_auto_1fr]">
            <div className="rounded-xl border border-line bg-white p-5 shadow-card">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Your AI agents</h3>
              <ul className="mt-3 space-y-1.5 text-[15px] font-medium text-ink">
                {["n8n · Make", "LangChain · LangGraph", "OpenAI and Claude SDKs", "Custom code"].map((a) => <li key={a}>{a}</li>)}
              </ul>
            </div>
            <ArrowRight className="mx-auto hidden h-6 w-6 self-center text-line-strong lg:block" />
            <div className="rounded-xl border-2 border-himal-700 bg-white p-5 text-ink shadow-lift">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-himal-600">AgentGuard checkpoints</h3>
              <ul className="mt-3 space-y-2.5 text-[15px]">
                <li className="flex gap-3"><Gauge className="mt-0.5 h-5 w-5 shrink-0 text-himal-700" /><span><strong>AI-model gateway</strong><span className="block text-sm text-ink-muted">cost and replies</span></span></li>
                <li className="flex gap-3"><SlidersHorizontal className="mt-0.5 h-5 w-5 shrink-0 text-himal-700" /><span><strong>Tool gateway (MCP)</strong><span className="block text-sm text-ink-muted">which tools, which data</span></span></li>
                <li className="flex gap-3"><KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-himal-700" /><span><strong>Credential vault</strong><span className="block text-sm text-ink-muted">real keys never leave</span></span></li>
              </ul>
              <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4 text-[13px] font-bold">
                <span className="inline-flex items-center gap-1 rounded-full bg-terai-500 px-2.5 py-1 text-white"><Check className="h-3.5 w-3.5" />ALLOW</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-marigold-500 px-2.5 py-1 text-himal-950"><Hand className="h-3.5 w-3.5" />ASK A HUMAN</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-simrik-500 px-2.5 py-1 text-white"><Ban className="h-3.5 w-3.5" />BLOCK</span>
              </div>
            </div>
            <ArrowRight className="mx-auto hidden h-6 w-6 self-center text-line-strong lg:block" />
            <div className="rounded-xl border border-line bg-white p-5 shadow-card">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">The real world</h3>
              <ul className="mt-3 space-y-1.5 text-[15px] font-medium text-ink">
                {["AI models", "Stripe · Slack", "CRM · email", "Databases"].map((a) => <li key={a}>{a}</li>)}
              </ul>
            </div>
          </div>

          <div className="mt-8 grid gap-5 md:grid-cols-2">
            <div className="rounded-xl border border-himal-200 bg-himal-50 p-5">
              <h3 className="flex items-center gap-2 text-lg font-semibold text-himal-900"><Lock className="h-5 w-5 text-himal-700" />Enforced</h3>
              <p className="mt-1 text-[15px] text-ink-soft">Vault, AI-model gateway, MCP gateway. Traffic physically passes through AgentGuard, so the agent cannot skip the rules, provided the real keys live only here.</p>
            </div>
            <div className="rounded-xl border border-line bg-white p-5">
              <h3 className="flex items-center gap-2 text-lg font-semibold text-himal-900"><ShieldQuestion className="h-5 w-5 text-ink-muted" />Cooperative</h3>
              <p className="mt-1 text-[15px] text-ink-soft">SDK, n8n and Make steps, the check API. The agent asks before acting. Quick to add, and honest about what it is: it relies on the developer using it.</p>
            </div>
          </div>
          <p className="mt-4 text-[15px] text-ink-soft">A coverage score always shows which of your agents are fully protected, which are cooperative, and which are not covered at all.</p>
        </div>
      </section>

      {/* the refund */}
      <section className="border-y border-line bg-white">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <p className="text-sm font-semibold uppercase tracking-wider text-himal-600">In practice</p>
          <h2 className="mt-2 text-3xl font-semibold text-himal-900">A $450 refund, handled safely</h2>
          <ol className="mt-8 grid gap-4 md:grid-cols-5">
            {REFUND.map((step, i) => (
              <li key={i} className="rounded-xl border border-line bg-white p-4 shadow-card">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-himal-600 font-display font-semibold text-white">{i + 1}</span>
                <p className="mt-3 text-[15px] leading-snug text-ink-soft">{step}</p>
              </li>
            ))}
          </ol>
          <p className="mt-8 max-w-3xl text-lg text-ink-soft">
            <strong className="text-ink">No approval, no refund.</strong> Locked to the exact order and amount, protected against duplicates, and fully recorded for the owner and auditors.
          </p>
        </div>
      </section>

      {/* journey */}
      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-3xl font-semibold text-himal-900">Confidence, one step at a time</h2>
          <ol className="mt-8 grid gap-4 md:grid-cols-5">
            {JOURNEY.map(([name, body], i) => (
              <li key={name} className="relative rounded-xl border border-line bg-white p-5 shadow-card">
                <span className="font-display text-sm font-semibold text-himal-500">Step {i + 1}</span>
                <h3 className="mt-1 text-xl font-semibold text-himal-900">{name}</h3>
                <p className="mt-1 text-[15px] text-ink-soft">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* comparison */}
      <section className="border-y border-line bg-white">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-3xl font-semibold text-himal-900">Where AgentGuard fits</h2>
          <p className="mt-2 max-w-3xl text-[17px] text-ink-soft">Each category is good at its part. AgentGuard is the combination, across platforms, simple enough for a team without a security department.</p>
          <div className="mt-8 overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[760px] text-center text-[15px]">
              <thead className="bg-paper-deep/60 text-sm text-ink-soft">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold" />
                  {["Works across platforms", "Prevents risky actions", "Human approval", "Spending limits", "Simple self-serve"].map((h) => (
                    <th key={h} className="px-3 py-3 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARE.map(([name, examples, cells]) => (
                  <tr key={name} className="border-t border-line">
                    <th className="px-4 py-3.5 text-left font-semibold text-ink">
                      {name}
                      <span className="block text-[13px] font-normal text-ink-muted">{examples}</span>
                    </th>
                    {cells.map((c, i) => <td key={i} className="px-3 py-3.5"><Mark value={c} /></td>)}
                  </tr>
                ))}
                <tr className="border-t-2 border-himal-600 bg-himal-50/60">
                  <th className="px-4 py-4 text-left font-display text-lg font-semibold text-himal-900">AgentGuard</th>
                  {[0, 1, 2, 3, 4].map((i) => <td key={i} className="px-3 py-4"><Mark value="yes" /></td>)}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-ink-muted">A category-level view; individual products vary.</p>
        </div>
      </section>

      {/* plans */}
      <section id="plans" className="scroll-mt-16 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-3xl font-semibold text-himal-900">Start free. Grow into control.</h2>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {[
              ["Free", "Observe mode", "Connect agents, see activity and costs. The easy first step.", false],
              ["Pro", "Priced by agents and governed actions", "Rules, approvals, budgets, reply checks and the credential vault.", true],
              ["Agency", "Many client workspaces", "Manage every client's agents from one account, with client views.", false],
            ].map(([name, basis, body, featured]) => (
              <article key={name as string} className={`rounded-2xl border bg-white p-6 shadow-card ${featured ? "border-himal-300 ring-2 ring-himal-100" : "border-line"}`}>
                <h3 className="font-display text-2xl font-semibold text-himal-900">{name}</h3>
                <p className="mt-1 text-sm font-semibold uppercase tracking-wide text-himal-600">{basis}</p>
                <p className="mt-3 text-[15px] text-ink-soft">{body}</p>
              </article>
            ))}
          </div>
          <p className="mt-4 text-sm text-ink-muted">Prices are being set with design partners during the beta. The Agency plan describes what is planned; client workspaces are not built yet.</p>
        </div>
      </section>

      {/* closing */}
      <section className="border-t border-line bg-white">
        <div className="relative z-10 mx-auto max-w-6xl px-5 pb-16 pt-16 text-center">
          <h2 className="text-3xl font-semibold text-himal-900 sm:text-4xl">Every AI agent. Under control.</h2>
          <p className="mx-auto mt-3 max-w-xl text-lg text-ink-soft">Let&apos;s build the safety layer for the agent economy together.</p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href="/login" className={buttonClass("primary", "md", "h-12 px-6 text-base")}>Open the live demo</Link>
            <Link href="/signup" className="inline-flex h-12 items-center rounded-lg border border-line-strong px-6 text-base font-semibold text-ink hover:bg-paper-deep">Create a workspace</Link>
          </div>
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
