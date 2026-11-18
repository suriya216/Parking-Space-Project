// Runs the manual registration spec.
//
//   REG_PASSWORD=... npm run test:register -- --email a@b.com
//
// Or set REG_EMAIL / REG_PASSWORD / REG_NAME / REG_ROLE yourself. Headed,
// single worker. MANUAL=1 is what makes the `manual` project exist in
// playwright.config.ts; the pipeline never sets it.

import { spawn } from "node:child_process";

const child = spawn(
  "npx",
  ["playwright", "test", "--project=manual", "--headed", "--workers=1", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: { ...process.env, MANUAL: "1" },
    shell: process.platform === "win32",
  },
);

child.on("exit", (code) => process.exit(code ?? 1));
