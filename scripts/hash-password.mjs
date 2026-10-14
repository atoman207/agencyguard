// Prints a password hash in the format AgentGuard stores (scrypt, same as
// src/server/crypto.ts), for pasting into supabase/database.sql.
//
//   node scripts/hash-password.mjs "the password"

import crypto from "node:crypto";

const password = process.argv[2];
if (!password) {
  console.error('Usage: node scripts/hash-password.mjs "<password>"');
  process.exitCode = 1;
} else {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  console.log(`scrypt$${salt.toString("base64")}$${hash.toString("base64")}`);
}
