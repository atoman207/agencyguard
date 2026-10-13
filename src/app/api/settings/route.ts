import { readJson, route, sessionAuth } from "@/server/api";
import { updateSettings } from "@/server/settings";

// POST /api/settings — change organization settings. Send only the fields to change.
export const POST = route(async (request) => {
  const auth = await sessionAuth("owner");
  const settings = updateSettings(auth.org, auth.actor, await readJson(request), Date.now());
  return Response.json({ settings: { ...settings, notifications: { ...settings.notifications, webhookSecret: settings.notifications.webhookSecret ? "set" : "" } } });
});
