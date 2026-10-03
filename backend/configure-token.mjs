// Generates a personal access token without including it in command arguments or output.
// The local copy is ignored by Git and used to place the token on the user's clipboard.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const folder = dirname(fileURLToPath(import.meta.url));
const path = join(folder, ".scanner-token");
const token = existsSync(path)
  ? readFileSync(path, "utf8").trim()
  : randomBytes(32).toString("hex");
const result = spawnSync(
  process.execPath,
  [join(folder, "node_modules/wrangler/bin/wrangler.js"), "secret", "bulk"],
  {
    cwd: folder,
    input: JSON.stringify({ SCAN_TOKEN: token }),
    encoding: "utf8",
    windowsHide: true,
  },
);
if (result.status !== 0) {
  console.error("Scanner token configuration failed.");
  process.exit(1);
}
writeFileSync(path, token, { mode: 0o600 });
console.log(
  "Scanner token configured securely. Local copy is excluded from Git.",
);
