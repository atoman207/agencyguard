import { route, sessionAuth } from "@/server/api";
import { allAudit, audit, verifyAudit } from "@/server/audit";

const csvCell = (value: unknown) => {
  let text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  // Stop spreadsheet programs treating a cell as a formula.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

// GET /api/audit/export?format=csv|json — the full audit trail with its hash chain.
export const GET = route(async (request) => {
  const auth = await sessionAuth("admin");
  const format = new URL(request.url).searchParams.get("format") === "json" ? "json" : "csv";
  const entries = await allAudit(auth.org.id);
  const integrity = await verifyAudit(auth.org.id);
  const now = Date.now();
  await audit(auth.org.id, auth.actor, "audit.exported", { type: "audit_log", id: null }, { format, entries: entries.length }, now);
  const stamp = new Date(now).toISOString().slice(0, 10);

  if (format === "json") {
    return new Response(JSON.stringify({ organization: auth.org.name, exported_at: new Date(now).toISOString(), integrity, entries }, null, 2), {
      headers: { "content-type": "application/json", "content-disposition": `attachment; filename="agentguard-audit-${stamp}.json"` },
    });
  }
  const header = ["seq", "time_utc", "actor_type", "actor", "action", "target_type", "target_id", "details", "prev_hash", "hash"];
  const rows = entries.map((e) =>
    [e.seq, new Date(e.created_at).toISOString(), e.actor_type, e.actor_label, e.action, e.target_type, e.target_id ?? "", JSON.stringify(e.details), e.prev_hash, e.hash].map(csvCell).join(","),
  );
  return new Response([header.join(","), ...rows].join("\r\n"), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="agentguard-audit-${stamp}.csv"` },
  });
});
