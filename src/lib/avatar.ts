import type { Role } from "@/lib/types";

/** Avatar path for a signed-in user. Uploaded photo wins; otherwise role defaults. */
export function avatarForUser(user: { role: Role; email?: string; avatar?: string | null }): string {
  if (user.avatar) return user.avatar;
  if (user.role === "admin" || user.role === "owner" || user.email === "admin@gmail.com") {
    return "/agent_favicon.png";
  }
  return "/avatar4.png";
}
