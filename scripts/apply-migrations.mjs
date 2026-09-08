import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

/**
 * Apply every migration in supabase/migrations, in filename order.
 *
 *   DATABASE_URL="postgresql://..." node scripts/apply-migrations.mjs
 *
 * Exists because pasting a large schema into the Supabase SQL editor proved
 * unreliable — a partial paste applies partial DDL and reports success on
 * whatever statement it happened to reach last. Applying over a real
 * connection either works or fails loudly.
 *
 * Every migration is idempotent, so re-running this is safe and is the
 * intended way to repair a half-applied schema.
 */

const DIR = "supabase/migrations";

/**
 * Either pass a full DATABASE_URL, or pass SUPABASE_PROJECT_REF and
 * SUPABASE_DB_PASSWORD and let this find the right endpoint.
 *
 * The discovery exists because Supabase's direct host is IPv6-only, which many
 * networks cannot reach, and the IPv4 alternative is a paid add-on. The
 * session pooler is the free path, but its hostname encodes a region that the
 * dashboard does not always render — so we try the plausible ones and keep
 * whichever accepts the credentials.
 */
const POOLER_REGIONS = [
  "aws-1-us-west-1", "aws-0-us-west-1",
  "aws-1-us-west-2", "aws-0-us-west-2",
  "aws-1-us-east-1", "aws-0-us-east-1",
  "aws-1-us-east-2", "aws-0-us-east-2",
];

function candidates() {
  if (process.env.DATABASE_URL) return [process.env.DATABASE_URL];

  const ref = process.env.SUPABASE_PROJECT_REF;
  const password = process.env.SUPABASE_DB_PASSWORD;

  if (!ref || !password) {
    console.error(
      "Set DATABASE_URL, or SUPABASE_PROJECT_REF and SUPABASE_DB_PASSWORD.",
    );
    process.exit(1);
  }

  return POOLER_REGIONS.map(
    (region) =>
      `postgresql://postgres.${ref}:${encodeURIComponent(password)}` +
      `@${region}.pooler.supabase.com:5432/postgres`,
  );
}

async function connect() {
  const options = candidates();
  let lastError;

  for (const connectionString of options) {
    const client = new pg.Client({
      connectionString,
      // Supabase terminates TLS with a certificate this client does not have
      // the chain for; the connection is still encrypted.
      ssl: { rejectUnauthorized: false },
      // A big DDL script should not sit forever if something is locked.
      statement_timeout: 120_000,
      connectionTimeoutMillis: 10_000,
    });

    try {
      await client.connect();
      const host = new URL(connectionString).host;
      console.log(`Connected via ${host}\n`);
      return client;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => {});

      // Wrong region for this project: keep looking. A bad password, though,
      // will fail identically everywhere, so say so rather than listing eight
      // failures.
      if (!/Tenant or user not found/i.test(error.message)) {
        if (/password authentication failed/i.test(error.message)) {
          console.error("The database password was not accepted.");
          process.exit(1);
        }
      }
    }
  }

  console.error(`Could not connect: ${lastError?.message}`);
  process.exit(1);
}

const client = await connect();

const files = (await readdir(DIR)).filter((f) => f.endsWith(".sql")).sort();

for (const file of files) {
  const sql = await readFile(path.join(DIR, file), "utf8");
  process.stdout.write(`${file} … `);

  try {
    // Each migration runs as one transaction: it either lands completely or
    // not at all, which is exactly what the copy-paste route could not promise.
    await client.query("begin");
    await client.query(sql);
    await client.query("commit");
    console.log("applied");
  } catch (error) {
    await client.query("rollback");
    console.log("FAILED");
    console.error(`\n  ${error.message}`);
    if (error.position) {
      const upto = sql.slice(0, Number(error.position));
      console.error(`  at line ${upto.split("\n").length}`);
    }
    await client.end();
    process.exit(1);
  }
}

// The API keeps a cached picture of the schema and will 404 on a brand-new
// table until it reloads.
await client.query("notify pgrst, 'reload schema'");

const { rows } = await client.query(`
  select table_name
  from information_schema.tables
  where table_schema = 'public'
  order by table_name
`);

console.log(`\n${rows.length} tables in public:`);
for (const row of rows) console.log(`  - ${row.table_name}`);

const { rows: buckets } = await client.query(
  "select id, public from storage.buckets order by id",
);
console.log(`\n${buckets.length} storage buckets:`);
for (const b of buckets) console.log(`  - ${b.id} (${b.public ? "public" : "private"})`);

await client.end();
console.log("\nDone.\n");
