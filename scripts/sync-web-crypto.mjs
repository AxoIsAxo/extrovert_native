#!/usr/bin/env node
// Syncs the web app's E2EE crypto JS (single source of truth, never hand-copied)
// into this repo. Source: the server repo at $EXTV_WEB_REPO (default ../extrovert).
// Run: node scripts/sync-web-crypto.mjs
import { cpSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = process.env.EXTV_WEB_REPO || join(root, "..", "extrovert");
const pub = join(src, "public");

const files = [
  ["lib/olm.js", join(root, "src", "vendor", "olm.js")],
  ["lib/olm.wasm", join(root, "public", "olm.wasm")],
  ["e2ee.js", join(root, "src", "vendor", "e2ee.js")],
  ["room-e2ee.js", join(root, "src", "vendor", "room-e2ee.js")],
];

if (!existsSync(join(pub, "e2ee.js"))) {
  console.error(`Server repo not found at ${src}. Set EXTV_WEB_REPO to the extrovert web repo.`);
  process.exit(1);
}

for (const [rel, dest] of files) {
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(join(pub, rel), dest);
  console.log(`synced ${rel} -> ${dest.replace(root + "/", "")}`);
}

console.log("Done. Commit the vendored files; they are the app's build input.");
