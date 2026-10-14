import "server-only";
import fs from "node:fs";
import path from "node:path";

const ALLOWED = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

const MAX_BYTES = 2 * 1024 * 1024;

export function assertAvatarFile(file: File): string {
  const ext = ALLOWED.get(file.type);
  if (!ext) throw new Error("Avatar must be a JPEG, PNG, WebP or GIF image.");
  if (file.size <= 0) throw new Error("Choose an avatar image.");
  if (file.size > MAX_BYTES) throw new Error("Avatar must be 2 MB or smaller.");
  return ext;
}

/**
 * Returns a value to store in `users.avatar`.
 * On Vercel: data URL (read-only filesystem). Locally: file under public/avatars.
 */
export async function saveAvatarFile(userId: string, file: File): Promise<string> {
  const ext = assertAvatarFile(file);
  const bytes = Buffer.from(await file.arrayBuffer());

  if (process.env.VERCEL === "1") {
    const mime = [...ALLOWED.entries()].find(([, e]) => e === ext)?.[0] ?? file.type;
    return `data:${mime};base64,${bytes.toString("base64")}`;
  }

  const dir = path.join(process.cwd(), "public", "avatars");
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${userId}.${ext}`;
  fs.writeFileSync(path.join(dir, filename), bytes);
  return `/avatars/${filename}`;
}
