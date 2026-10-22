/**
 * Read-only viewer for the SQLite database the API server uses.
 *
 *   node scripts/db-query.mjs                      list tables + row counts
 *   node scripts/db-query.mjs users                dump a table (100 rows)
 *   node scripts/db-query.mjs users 5              dump a table, N rows
 *   node scripts/db-query.mjs "SELECT ... "        run any read-only SQL
 *
 * Point it at another file with PARKSPACE_DB, e.g. the Playwright database:
 *   PARKSPACE_DB=server/test-data/parkspace.db node scripts/db-query.mjs
 */
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.PARKSPACE_DB ?? "server/parkspace.db";
const db = new DatabaseSync(DB_PATH, { readOnly: true });

const [target, limit = "100"] = process.argv.slice(2);

/* Plain rows: the driver returns null-prototype objects, which console.table
   and JSON.stringify both render awkwardly. */
const plain = (rows) => rows.map((r) => ({ ...r }));

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
  .all()
  .map((r) => r.name)
  .filter((n) => !n.startsWith("sqlite_"));

console.log(`database: ${DB_PATH}\n`);

if (!target) {
  console.table(
    tables.map((name) => ({
      table: name,
      rows: db.prepare(`SELECT count(*) AS n FROM "${name}"`).get().n,
    })),
  );
} else if (tables.includes(target)) {
  const n = Number.parseInt(limit, 10);
  console.table(plain(db.prepare(`SELECT * FROM "${target}" LIMIT ?`).all(n)));
} else if (/^\s*(select|pragma|with)\b/i.test(target)) {
  console.table(plain(db.prepare(target).all()));
} else {
  console.error(
    `Unknown table "${target}". Available: ${tables.join(", ")}\n` +
      "Read-only SQL (SELECT / PRAGMA / WITH) is also accepted.",
  );
  process.exitCode = 1;
}

db.close();
