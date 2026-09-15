// Repairs a UTF-8 file whose bytes were decoded as Windows-1252 and then
// re-saved as UTF-8 (classic PowerShell Get-Content/Set-Content damage).
//
//   node e2e/encoding-repair.mjs src/App.jsx
//
// Reversing it is exact: map each character back to the cp1252 byte it
// came from, then decode the resulting bytes as UTF-8. cp1252 matches
// latin1 except for 0x80-0x9F, so those need an explicit table —
// assuming latin1 throughout is what made a first attempt fail.

import { readFileSync, writeFileSync } from "node:fs";

// cp1252 byte -> Unicode codepoint, for the range that differs from latin1.
const CP1252_HIGH = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
  0x9e: 0x017e, 0x9f: 0x0178,
};
// Inverted: codepoint -> originating byte.
const TO_BYTE = new Map(Object.entries(CP1252_HIGH).map(([b, cp]) => [cp, Number(b)]));

const file = process.argv[2];
if (!file) {
  console.error("usage: node e2e/encoding-repair.mjs <file>");
  process.exit(2);
}

const raw = readFileSync(file, "utf8");
// PowerShell's `Set-Content -Encoding utf8` prepends a BOM. It's a
// separate artefact from the mojibake: strip it here and write the file
// back without one, which is what Vite and every other tool expects.
const hadBom = raw.charCodeAt(0) === 0xfeff;
const before = hadBom ? raw.slice(1) : raw;

const bytes = [];
for (const ch of before) {
  const cp = ch.codePointAt(0);
  if (TO_BYTE.has(cp)) bytes.push(TO_BYTE.get(cp));
  else if (cp <= 0xff) bytes.push(cp);
  else {
    // A character outside cp1252's range was never part of the damage, so
    // the whole-file assumption is wrong — bail rather than mangle it.
    console.error(`ABORT: U+${cp.toString(16).toUpperCase()} (${JSON.stringify(ch)}) is not representable in cp1252.`);
    process.exit(1);
  }
}

const repaired = Buffer.from(bytes).toString("utf8");

// ── validation ──
const MOJIBAKE = /[ÂÃâð][-¿–-›Œ-Ÿ]/g;
const bad = (s) => (s.match(MOJIBAKE) ?? []).length;
const replacements = (repaired.match(/�/g) ?? []).length;

if (replacements > 0) {
  console.error(`ABORT: produced ${replacements} replacement char(s); encoding assumption is wrong.`);
  process.exit(1);
}
if (bad(repaired) >= bad(before)) {
  console.error(`ABORT: mojibake not reduced (${bad(before)} -> ${bad(repaired)}).`);
  process.exit(1);
}

writeFileSync(file, repaired, "utf8");

const tally = ["₹", "─", "–", "—", "★", "✓", "·", "±", "©", "›", "…", "“", "”", "❤️", "🤍", "🚗", "🏠", "🛡️"]
  .map((c) => [c, repaired.split(c).length - 1])
  .filter(([, n]) => n > 0)
  .map(([c, n]) => `${c}×${n}`)
  .join("  ");

console.log(`${file}`);
console.log(`  BOM removed: ${hadBom}`);
console.log(`  mojibake: ${bad(before)} -> ${bad(repaired)}`);
console.log(`  recovered: ${tally}`);
