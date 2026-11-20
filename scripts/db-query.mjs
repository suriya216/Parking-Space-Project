/**
 * Read-only viewer for the database the API server uses.
 *
 *   node scripts/db-query.mjs                      list tables + row counts
 *   node scripts/db-query.mjs users                dump a table (100 rows)
 *   node scripts/db-query.mjs users 5              dump a table, N rows
 *   node scripts/db-query.mjs "SELECT ... "        run any read-only SQL
 *
 * With DATABASE_URL set it reads that Postgres (Neon). Otherwise it opens
 * the local PGlite directory, which only one process can hold at a time, so
 * stop `npm run dev` first. Point it at the Playwright database with:
 *   PARKSPACE_DB=server/test-data/pgdata node scripts/db-query.mjs
 */
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

const URL = (process.env.DATABASE_URL ?? "").trim();
const LOCAL = process.env.PARKSPACE_DB ?? "server/pgdata";

let run;
let close;
if (URL) {
  const pool = new pg.Pool({ connectionString: URL, max: 1 });
  run = async (sql, params = []) => (await pool.query(sql, params)).rows;
  close = () => pool.end();
} else {
  const lite = new PGlite(LOCAL);
  await lite.waitReady;
  run = async (sql, params = []) => (await lite.query(sql, params)).rows;
  close = () => lite.close();
}

const [target, limit = "100"] = process.argv.slice(2);

const tables = (
  await run("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name")
).map((r) => r.table_name);

console.log(`database: ${URL ? "postgres (DATABASE_URL)" : LOCAL}\n`);

try {
  if (!target) {
    const rows = [];
    for (const name of tables) {
      rows.push({ table: name, rows: Number((await run(`SELECT count(*) AS n FROM "${name}"`))[0].n) });
    }
    console.table(rows);
  } else if (tables.includes(target)) {
    const n = Number.parseInt(limit, 10);
    console.table(await run(`SELECT * FROM "${target}" LIMIT $1`, [n]));
  } else if (/^\s*select\b/i.test(target)) {
    console.table(await run(target));
  } else {
    console.error(`Unknown table "${target}". Tables: ${tables.join(", ")}`);
    process.exitCode = 1;
  }
} finally {
  await close();
}
