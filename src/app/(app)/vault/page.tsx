import type { Metadata } from "next";
import { Cpu, KeyRound, Lock, Network, Trash2 } from "@/components/icons";
import { deleteCredentialAction, deleteMcpServerAction, saveCredentialAction, saveMcpServerAction, setKeysRotatedAction } from "@/app/actions";
import { AutoSubmitSwitch } from "@/components/controls";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Callout, Card, CardHeader, EmptyState, Mono, PageHeader } from "@/components/ui";
import { getAction } from "@/lib/catalog";
import { dateTime, money } from "@/lib/format";
import { requireSession } from "@/server/auth";
import { BUILTIN_DEMO, listMcpServers } from "@/server/mcp";
import { requestOrigin } from "@/server/origin";
import { atLeast } from "@/server/users";
import { CONNECTORS, listCredentials, listSandboxCharges } from "@/server/vault";

export const metadata: Metadata = { title: "Vault & gateways" };

export default async function VaultPage() {
  const { org, user } = await requireSession();
  const origin = await requestOrigin();
  const creds = new Map((await listCredentials(org.id)).map((c) => [c.connector, c]));
  const servers = await listMcpServers(org.id);
  const canEdit = atLeast(user.role, "admin");
  const charges = creds.get("stripe")?.mode === "sandbox" ? (await listSandboxCharges(org.id)).slice(0, 8) : [];
  const tz = org.settings.timezone;

  return (
    <>
      <PageHeader title="Vault & gateways" lead="The enforced checkpoints. Real keys live here and nowhere else; agents hold only an AgentGuard token and ask the vault to act." />

      <div className="mb-5 grid gap-4 md:grid-cols-2">
        <Callout tone="good" icon={<Lock className="h-5 w-5" />} title="How keys are stored">
          Each key is encrypted with its own data key, which is wrapped by a master key (AES-256-GCM). Keys are never shown again, never logged and never sent to an agent.
        </Callout>
        <Callout tone="warn" title="After moving a key here, rotate the old one">
          Enforcement only holds if the agent has no other copy. Create a new key for AgentGuard, then revoke the one the agent used before.
        </Callout>
      </div>

      <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-himal-900"><KeyRound className="h-5 w-5 text-simrik-500" />Credential vault</h2>
      <div className="grid gap-5 md:grid-cols-2">
        {CONNECTORS.map((c) => {
          const cred = creds.get(c.id);
          return (
            <Card key={c.id} className="flex flex-col">
              <div className="flex items-start justify-between gap-3 px-5 pt-5">
                <div>
                  <h3 className="flex items-center gap-2 text-base font-semibold text-himal-900">
                    {c.kind === "model" && <Cpu className="h-4 w-4 text-himal-500" />}
                    {c.label}
                  </h3>
                  <p className="mt-0.5 text-sm text-ink-muted">{c.description}</p>
                </div>
                {cred ? <Badge tone={cred.mode === "live" ? "good" : "info"}>{cred.mode === "live" ? `Live ${cred.hint}` : "Sandbox"}</Badge> : <Badge>Not connected</Badge>}
              </div>

              {c.actions.length > 0 && (
                <ul className="mt-3 space-y-1.5 px-5 text-sm">
                  {c.actions.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-medium text-ink">{a.label}</span>
                      <span className="text-ink-muted">· {getAction(a.action).risk} risk</span>
                      {!a.liveSupported && <Badge>sandbox only</Badge>}
                      <Mono className="w-full sm:w-auto">POST /v1/actions/{c.id}/{a.id}</Mono>
                    </li>
                  ))}
                </ul>
              )}
              {c.kind === "model" && (
                <p className="mt-3 px-5 text-sm text-ink-soft">
                  Gateway address: <Mono>{origin}/gateway/v1</Mono>. Without a key here, the gateway answers from a built-in sandbox model so you can try it.
                </p>
              )}

              <div className="mt-4 flex-1 border-t border-line p-5">
                {cred?.mode === "live" && canEdit && (
                  <ActionForm action={setKeysRotatedAction} quiet className="mb-4 flex items-center gap-3 rounded-lg bg-paper px-3 py-2">
                    <input type="hidden" name="connector" value={c.id} />
                    <AutoSubmitSwitch name="rotated" defaultChecked={!!cred.keys_rotated} label="Old keys rotated" />
                    <span className="text-sm text-ink-soft">The old key is rotated; this copy is the only one.</span>
                  </ActionForm>
                )}
                {canEdit ? (
                  <details open={!cred}>
                    <summary className="cursor-pointer text-sm font-semibold text-himal-700 hover:underline">{cred ? "Replace the key or change mode" : "Connect"}</summary>
                    <ActionForm action={saveCredentialAction} resetOnSuccess className="mt-3">
                      <input type="hidden" name="connector" value={c.id} />
                      <div className="grid gap-3 sm:grid-cols-[9rem_1fr]">
                        <div>
                          <label className="field-label" htmlFor={`mode-${c.id}`}>Mode</label>
                          <select id={`mode-${c.id}`} name="mode" className="field" defaultValue={cred?.mode ?? "sandbox"}>
                            <option value="sandbox">Sandbox</option>
                            <option value="live">Live</option>
                          </select>
                        </div>
                        <div>
                          <label className="field-label" htmlFor={`key-${c.id}`}>{c.secretLabel}</label>
                          <input id={`key-${c.id}`} name="api_key" type="password" autoComplete="off" className="field" placeholder="Not needed for sandbox" />
                        </div>
                      </div>
                      {c.kind === "model" && (
                        <div className="mt-3">
                          <label className="field-label" htmlFor={`base-${c.id}`}>Provider base URL</label>
                          <input id={`base-${c.id}`} name="base_url" className="field" placeholder="https://api.openai.com/v1" />
                          <p className="field-hint">Any OpenAI-compatible endpoint.</p>
                        </div>
                      )}
                      <div className="mt-3 flex gap-2">
                        <SubmitButton variant="secondary">{cred ? "Save" : "Connect"}</SubmitButton>
                      </div>
                    </ActionForm>
                    {cred && (
                      <ActionForm action={deleteCredentialAction} quiet className="mt-2">
                        <input type="hidden" name="connector" value={c.id} />
                        <SubmitButton variant="ghost" size="sm" confirm={`Disconnect ${c.label}? Agents will no longer be able to use it through the vault.`}>
                          <Trash2 className="h-4 w-4" />
                          Disconnect
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </details>
                ) : (
                  <p className="text-sm text-ink-muted">Connecting needs the admin role.</p>
                )}
              </div>
            </Card>
          );
        })}
      </div>
      <p className="mt-3 text-sm text-ink-muted">Sandbox mode simulates the service so the whole flow can be tried without real accounts. Live mode calls the real API and has not yet been tested against real accounts: start with test keys.</p>

      <h2 className="mb-3 mt-8 flex items-center gap-2 text-lg font-semibold text-himal-900"><Network className="h-5 w-5 text-simrik-500" />MCP gateway</h2>
      <Card>
        <CardHeader title="MCP tool servers" hint="Point the MCP client of the agent at the AgentGuard address instead of the server. Every tool call passes the rules first." />
        {servers.length === 0 ? (
          <EmptyState title="No MCP servers registered" body="Register a server to put its tools behind the gateway. Tools are discovered automatically the first time the agent lists them." />
        ) : (
          <ul className="divide-y divide-line">
            {servers.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-4 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-ink">{s.name}</div>
                  <div className="mt-0.5 text-sm text-ink-muted">Forwards to {s.url === BUILTIN_DEMO ? "the built-in demo server" : s.url}</div>
                  <div className="mt-1 text-sm text-ink-soft">Agents connect to <Mono>{origin}/mcp/{s.slug}</Mono></div>
                </div>
                {canEdit && (
                  <ActionForm action={deleteMcpServerAction} quiet>
                    <input type="hidden" name="slug" value={s.slug} />
                    <SubmitButton variant="ghost" size="sm" aria-label={`Remove ${s.name}`} confirm={`Remove ${s.name}?`}>
                      <Trash2 className="h-4 w-4" />
                    </SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <ActionForm action={saveMcpServerAction} resetOnSuccess className="border-t border-line p-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[10rem_1fr_1.4fr_1fr_auto] lg:items-end">
              <div>
                <label className="field-label" htmlFor="mcp-slug">Short name</label>
                <input id="mcp-slug" name="slug" className="field" placeholder="shop" required />
              </div>
              <div>
                <label className="field-label" htmlFor="mcp-name">Display name</label>
                <input id="mcp-name" name="name" className="field" placeholder="Shop tools" />
              </div>
              <div>
                <label className="field-label" htmlFor="mcp-url">Server address</label>
                <input id="mcp-url" name="url" className="field" placeholder="https://mcp.example.com/mcp" required />
              </div>
              <div>
                <label className="field-label" htmlFor="mcp-auth">Authorization header</label>
                <input id="mcp-auth" name="auth_header" type="password" autoComplete="off" className="field" placeholder="Bearer … (optional)" />
              </div>
              <SubmitButton variant="secondary">Register</SubmitButton>
            </div>
            <p className="field-hint">The credential of the server itself is stored encrypted and added by the gateway; the agent never sees it. Use <Mono>{BUILTIN_DEMO}</Mono> as the address for the built-in demo server.</p>
          </ActionForm>
        )}
      </Card>

      {charges.length > 0 && (
        <Card className="mt-5">
          <CardHeader title="Stripe sandbox" hint="Made-up charges to refund while trying the vault. Refunds are checked against the remaining amount, as Stripe does." />
          <div className="overflow-x-auto">
            <table className="ledger w-full min-w-[640px]">
              <thead>
                <tr>
                  <th>Charge</th>
                  <th>Customer</th>
                  <th>Description</th>
                  <th className="text-right">Amount</th>
                  <th className="text-right">Refunded</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {charges.map((c) => (
                  <tr key={c.id}>
                    <td><Mono>{c.id}</Mono></td>
                    <td className="text-sm">{c.customer_name}<span className="block text-[13px] text-ink-muted">{c.customer}</span></td>
                    <td className="text-sm text-ink-soft">{c.description}</td>
                    <td className="text-right tabular-nums">{money(c.amount, c.currency)}</td>
                    <td className="text-right tabular-nums">{c.refunded ? money(c.refunded, c.currency) : "—"}</td>
                    <td className="whitespace-nowrap text-sm text-ink-muted">{dateTime(c.created_at, tz)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
