// Runs the app exactly as production does, on this machine.
//
//   npm run prod:local
//
// Builds the SPA, then starts the server with NODE_ENV=production so it
// serves dist/ itself, demo shortcuts are disabled and the security
// headers are applied. Setting env vars this way rather than inline in an
// npm script keeps it working on Windows as well as Linux.

import { spawnSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

console.log("building the web app…");
const build = spawnSync(npm, ["run", "build"], { stdio: "inherit", shell: process.platform === "win32" });
if (build.status !== 0) process.exit(build.status ?? 1);

if (!existsSync(join("dist", "index.html"))) {
  console.error("build produced no dist/index.html");
  process.exit(1);
}

// A separate data directory so a local production run can't disturb the
// development database.
const dataDir = join("server", "prod-local-data");
mkdirSync(dataDir, { recursive: true });

const env = {
  ...process.env,
  NODE_ENV: "production",
  PORT: process.env.PORT ?? "3002",
  DATA_DIR: dataDir,
  // Real production requires this to be set explicitly; generate an
  // ephemeral one here so the smoke test can run unattended.
  SESSION_SECRET: process.env.SESSION_SECRET ?? randomBytes(48).toString("base64url"),
  DEMO_MODE: process.env.DEMO_MODE ?? "false",
};

console.log(`\nstarting production server on http://localhost:${env.PORT}`);
console.log(`  NODE_ENV=production  DEMO_MODE=${env.DEMO_MODE}  DATA_DIR=${dataDir}\n`);

const server = spawn(process.execPath, ["server/index.js"], { env, stdio: "inherit" });
server.on("exit", (code) => process.exit(code ?? 0));

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => server.kill(sig));
}
