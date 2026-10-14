import "server-only";
import fs from "node:fs";
import path from "node:path";
import { usesPostgres } from "./db";

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

function serverlessFilesystem(): boolean {
  return usesPostgres() || process.env.VERCEL === "1";
}

/**
 * Returns a value to store in `users.avatar`.
 * Locally: writes under public/avatars and returns a path.
 * On Vercel / Postgres: returns a data URL (read-only filesystem).
 */
export async function saveAvatarFile(userId: string, file: File): Promise<string> {
  const ext = assertAvatarFile(file);
  const bytes = Buffer.from(await file.arrayBuffer());

  if (serverlessFilesystem()) {
    const mime = [...ALLOWED.entries()].find(([, e]) => e === ext)?.[0] ?? file.type;
    return `data:${mime};base64,${bytes.toString("base64")}`;
  }

  const dir = path.join(process.cwd(), "public", "avatars");
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${userId}.${ext}`;
  fs.writeFileSync(path.join(dir, filename), bytes);
  return `/avatars/${filename}`;
}
