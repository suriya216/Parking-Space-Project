// Detects mojibake introduced by writing a UTF-8 source file through a
// tool that assumed a single-byte codepage. Reads the bytes and looks for
// UTF-8 sequences that were themselves re-encoded.
//
//   node scripts/encoding-check.mjs
//
// This app is full of characters that trip that up — ₹, en/em dashes, ★,
// •, › — so a single bad round trip through a codepage-guessing editor
// (or PowerShell's Get-Content/Set-Content) silently corrupts the UI.
// `scripts/encoding-repair.mjs` reverses it when that happens.
//
// Files are DISCOVERED rather than listed. An earlier version hardcoded
// six paths, two of which were later renamed from .js to .ts — so the
// check crashed on a missing file instead of checking anything, and
// nothing covered the newer shared/ and tests/ trees at all.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src", "shared", "server", "tests", "scripts"];
const EXTENSIONS = [".js", ".jsx", ".mjs", ".ts", ".tsx", ".css", ".md", ".json"];
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "uploads", "shots", "test-results"]);

/**
 * The two encoding tools themselves.
 *
 * They necessarily contain the very byte sequences being hunted — this
 * file holds the `[ÂÃâ]` class and an example of a mangled em dash, and
 * the repair script carries the whole cp1252 table. Scanning them
 * reports the detector as the fault.
 */
const SKIP_FILES = new Set([
  join("scripts", "encoding-check.mjs"),
  join("scripts", "encoding-repair.mjs"),
]);

/** Files at the repo root, which belong to no ROOTS directory. */
const ROOT_FILES = [
  "README.md",
  "DEPLOY.md",
  "index.html",
  "vite.config.js",
  "playwright.config.ts",
  "package.json",
  "tsconfig.json",
  ".oxlintrc.json",
  ".env.example",
];

/** Every source file under `dir`, recursively. */
const walk = (dir) => {
  const found = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else if (EXTENSIONS.some((ext) => entry.endsWith(ext))) found.push(full);
  }
  return found;
};

// Characters the UI legitimately uses that are multi-byte in UTF-8.
const EXPECTED = {
  "₹": "rupee",
  "–": "en dash",
  "—": "em dash",
  "★": "star",
  "•": "bullet",
  "›": "chevron",
  "…": "ellipsis",
  "“": "open quote",
  "”": "close quote",
};

// Classic double-encoding artefacts: a UTF-8 lead byte (0xC2/0xC3/0xE2,
// which decode as Â/Ã/â) followed by whatever cp1252 turned the next
// continuation byte into.
//
// The trailing class has to cover BOTH halves of cp1252, and getting it
// wrong makes this whole script useless. Bytes 0xA0-0xFF decode to
// U+00A0-U+00FF, but 0x80-0x9F decode to a scattered set of typographic
// characters — 0x80 is € (U+20AC), 0x94 is ” (U+201D). A range like
// [-¿] therefore misses the single most common case: an em
// dash, 0xE2 0x80 0x94, mangles to "â€”" whose middle character is
// U+20AC and so never matches. Enumerate the 0x80-0x9F set explicitly.
const CP1252_HIGH =
  "€‚ƒ„…†‡ˆ‰Š‹ŒŽ" +
  "‘’“”•–—˜™š›œžŸ";
const MOJIBAKE = new RegExp(`[ÂÃâ][\\u00a0-\\u00ff${CP1252_HIGH}]`, "g");

const exists = (path) => {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
};

const files = [
  ...ROOTS.filter((root) => exists(root) && statSync(root).isDirectory()).flatMap(walk),
  ...ROOT_FILES.filter(exists),
].filter((file) => !SKIP_FILES.has(file));

let bad = 0;
let checked = 0;
const clean = [];

for (const file of files) {
  const text = readFileSync(file, "utf8");
  checked += 1;

  const hits = [...text.matchAll(MOJIBAKE)];
  if (hits.length) {
    bad += hits.length;
    console.log(`FAIL ${file}: ${hits.length} mojibake sequence(s)`);
    const uniq = [...new Set(hits.map((h) => h[0]))].slice(0, 8);
    for (const u of uniq) {
      const codes = [...u]
        .map((c) => "U+" + c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0"))
        .join(" ");
      console.log(`     ${JSON.stringify(u)}  (${codes})`);
    }
    console.log(`     repair with: node scripts/encoding-repair.mjs ${file}`);
    continue;
  }

  // Only worth naming the files that actually carry the risky characters.
  const counts = Object.entries(EXPECTED)
    .map(([ch, name]) => [name, text.split(ch).length - 1])
    .filter(([, n]) => n > 0);
  if (counts.length) {
    clean.push(`${file}  [${counts.map(([n, c]) => `${n}:${c}`).join(" ")}]`);
  }
}

for (const line of clean) console.log(`ok   ${line}`);

console.log(
  bad
    ? `\n${bad} corrupted sequence(s) across ${checked} files — something was written with the wrong encoding.`
    : `\nNo mojibake found (${checked} files checked, ${clean.length} carrying multi-byte characters).`,
);
process.exitCode = bad ? 1 : 0;
