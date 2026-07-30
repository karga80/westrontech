import { readdir, readFile } from "fs/promises";
import { join, dirname } from "path";
import { env } from "@/config/env";
import { createLogger } from "@/shared/logger";
import pg from "pg";

const log = createLogger("migrations");
const { Pool } = pg;

const MIGRATIONS_DIR = join(dirname(new URL(import.meta.url).pathname), "../../migrations");

async function getPool() {
  return new Pool({ connectionString: env.POSTGRES_URL });
}

async function ensureMigrationsTable(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(pool: pg.Pool): Promise<Set<string>> {
  const res = await pool.query<{ filename: string }>("SELECT filename FROM schema_migrations");
  return new Set(res.rows.map((r) => r.filename));
}

async function runUp(): Promise<void> {
  const pool = await getPool();
  await ensureMigrationsTable(pool);
  const applied = await getAppliedMigrations(pool);

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) {
      log.debug({ file }, "Already applied, skipping");
      continue;
    }

    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    log.info({ file }, "Applying migration");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
      ran++;
      log.info({ file }, "Migration applied");
    } catch (err) {
      await client.query("ROLLBACK");
      log.error({ file, err }, "Migration failed — rolled back");
      throw err;
    } finally {
      client.release();
    }
  }

  if (ran === 0) {
    log.info("No new migrations to apply");
  } else {
    log.info({ ran }, "Migrations complete");
  }

  await pool.end();
}

async function runStatus(): Promise<void> {
  const pool = await getPool();
  await ensureMigrationsTable(pool);
  const applied = await getAppliedMigrations(pool);
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    const status = applied.has(file) ? "✓ applied" : "✗ pending";
    console.log(`${status}  ${file}`);
  }

  await pool.end();
}

const command = process.argv[2] ?? "up";
if (command === "up") {
  runUp().catch((err) => { console.error(err); process.exit(1); });
} else if (command === "status") {
  runStatus().catch((err) => { console.error(err); process.exit(1); });
} else {
  console.error(`Unknown command: ${command}. Use: up | status`);
  process.exit(1);
}
