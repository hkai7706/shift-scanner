// Capture CLI output: dashboard configuration diffs may contain unencrypted credentials.
// Only print secret names and the public endpoint, never raw deployment logs.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const folder = dirname(fileURLToPath(import.meta.url));
const cli = join(folder, "node_modules/wrangler/bin/wrangler.js");
const run = (args) =>
  spawnSync(process.execPath, [cli, ...args], {
    cwd: folder,
    encoding: "utf8",
    windowsHide: true,
  });
const configured = run(["secret", "list"]);
if (configured.status !== 0) {
  console.error(
    "Unable to check server secret names. Check Cloudflare login and Worker setup.",
  );
  process.exit(1);
}
let names;
try {
  names = JSON.parse(configured.stdout)
    .filter((x) => x.type === "secret_text")
    .map((x) => x.name);
} catch {
  console.error("Unable to validate server secrets.");
  process.exit(1);
}
const missing = ["OPENAI_API_KEY", "SCAN_TOKEN"].filter(
  (name) => !names.includes(name),
);
if (missing.length) {
  console.error(
    `Deployment stopped: add encrypted Cloudflare secrets: ${missing.join(", ")}. Do not use normal variables.`,
  );
  process.exit(1);
}
const deployed = run(["deploy"]);
if (deployed.status !== 0) {
  console.error(
    "Worker deployment failed. Raw CLI output withheld to protect credential values. Inspect status in Cloudflare.",
  );
  process.exit(1);
}
const endpoint = deployed.stdout.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/);
console.log("Scanner deployed with encrypted secrets.");
if (endpoint) console.log(endpoint[0]);
