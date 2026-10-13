import type { Role } from "@/lib/types";

/** Avatar path for a signed-in user. Admins use the brand mark; others use the user portrait. */
export function avatarForUser(user: { role: Role; email?: string }): string {
  if (user.role === "admin" || user.role === "owner" || user.email === "admin@gmail.com") {
    return "/agent_favicon.png";
  }
  return "/avatar4.png";
}
