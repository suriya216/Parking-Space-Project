// Runs the wider device matrix.
//
//   npm run test:devices            every phone and tablet profile
//   npm run test:devices -- -g pin  ...filtered, args pass through
//
// The extra profiles in playwright.config.ts are gated behind
// DEVICE_MATRIX so that `npm test` stays a sane length — without the
// gate, eight UI projects would run every time.
//
// This exists instead of `DEVICE_MATRIX=1 playwright test`, which is not
// portable: cmd.exe and PowerShell both reject the inline-env-var form,
// and pulling in `cross-env` for one variable is not worth a dependency.

import { spawn } from "node:child_process";

const PROJECTS = [
  "ios",
  "android",
  "ios-small",
  "android-narrow",
  "ios-tablet",
  "android-tablet",
];

const args = [
  "playwright",
  "test",
  ...PROJECTS.flatMap((p) => ["--project", p]),
  ...process.argv.slice(2),
];

console.log(`device matrix: ${PROJECTS.join(", ")}\n`);

const child = spawn("npx", args, {
  stdio: "inherit",
  env: { ...process.env, DEVICE_MATRIX: "1" },
  // npx is a shell script on Windows; without this it is not executable.
  shell: process.platform === "win32",
});

child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
