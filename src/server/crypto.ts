import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./db";

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(9).toString("base64url")}`;
}

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function hmac(secret: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

/** JSON with keys sorted at every level, so equal values always hash equally. */
export function canonical(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
}

/** The code an approval is locked to: the exact action, resource and parameters. */
export function fingerprint(action: string, resource: string | null, params: Record<string, unknown>): string {
  return `sha256:${sha256(canonical({ action, resource, params }))}`;
}

// --- passwords ---------------------------------------------------------------

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = crypto.scryptSync(password, Buffer.from(salt, "base64"), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

// --- vault encryption --------------------------------------------------------
// Envelope encryption: each secret gets its own data key, and the data key is
// wrapped by a master key. In production the master key belongs in a cloud KMS;
// here it comes from AGENTGUARD_MASTER_KEY, or a generated local file in dev.

let cachedMasterKey: Buffer | null = null;

function masterKey(): Buffer {
  if (cachedMasterKey) return cachedMasterKey;
  const fromEnv = process.env.AGENTGUARD_MASTER_KEY;
  if (fromEnv) {
    const key = Buffer.from(fromEnv, "base64");
    if (key.length !== 32) throw new Error("AGENTGUARD_MASTER_KEY must be 32 bytes, base64 encoded.");
    return (cachedMasterKey = key);
  }
  if (process.env.NODE_ENV === "production" && process.env.AGENTGUARD_ALLOW_LOCAL_KEY !== "true") {
    throw new Error("Set AGENTGUARD_MASTER_KEY before storing credentials in production.");
  }
  const file = path.join(DATA_DIR, "master.key");
  if (!fs.existsSync(file)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, crypto.randomBytes(32).toString("base64"), { mode: 0o600 });
  }
  return (cachedMasterKey = Buffer.from(fs.readFileSync(file, "utf8").trim(), "base64"));
}

function seal(key: Buffer, plaintext: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64")).join(".");
}

function open(key: Buffer, sealed: string): Buffer {
  const [iv, tag, body] = sealed.split(".").map((p) => Buffer.from(p, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

export function encryptSecret(plaintext: string): string {
  const dataKey = crypto.randomBytes(32);
  return JSON.stringify({ v: 1, key: seal(masterKey(), dataKey), data: seal(dataKey, Buffer.from(plaintext, "utf8")) });
}

export function decryptSecret(stored: string): string {
  const { key, data } = JSON.parse(stored) as { key: string; data: string };
  return open(open(masterKey(), key), data).toString("utf8");
}
