/**
 * What the app actually costs Cloudflare, and what is actually failing.
 *
 * Written because every performance decision until now was made from
 * wall-clock timings, and Cloudflare does not bill wall-clock. A page that
 * waits 300ms on Supabase and a page that spends 300ms rendering look
 * identical from outside and are nothing alike.
 *
 *   npm run cpu             the last 24 hours
 *   npm run cpu -- --week   the last 7 days
 *
 * WHAT THE FIRST RUN FOUND, and why this does not print a limit:
 *
 * The received wisdom — and what this file said in its first draft — is that a
 * free Worker gets 10ms of CPU and anything over that is Error 1102. The data
 * says otherwise. Successful requests routinely reach 500ms of CPU, while the
 * requests that DID fail were cut off around 75ms. A simple ceiling cannot
 * produce both.
 *
 * So this reports what happened rather than asserting a threshold: how many
 * requests failed, with what status, and how the CPU of the failures compares
 * to the CPU of everything that worked. `exceededResources` covers memory and
 * startup time as well as CPU, and the shape of these numbers suggests the
 * cause is not CPU alone.
 *
 * Read-only: needs Account Analytics: Read and nothing else.
 */

import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
);

const token = env.CLOUDFLARE_API_TOKEN;

if (!token) {
  console.error(
    "No CLOUDFLARE_API_TOKEN in .env.local.\n\n" +
      "Make one at dash.cloudflare.com → My Profile → API Tokens → Create Token\n" +
      "→ Custom token, with Account · Account Analytics · Read.",
  );
  process.exit(1);
}

const WEEK = process.argv.includes("--week");
const days = WEEK ? 7 : 1;
const window = days === 1 ? "24 hours" : "7 days";

const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
const until = new Date().toISOString();

/** The free plan's request allowance. This one is a real, published number. */
const REQUESTS_PER_DAY = 100_000;

async function graphql(query, variables) {
  const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });

  const json = await response.json();
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));

  return json.data;
}

const accounts = await fetch("https://api.cloudflare.com/client/v4/accounts", {
  headers: { Authorization: `Bearer ${token}` },
})
  .then((r) => r.json())
  .then((j) => j.result ?? []);

if (accounts.length === 0) {
  console.error("The token can see no accounts. Check its scope.");
  process.exit(1);
}

const accountTag = accounts[0].id;

/*
 * Split by status, not totalled.
 *
 * An average hides the failures, and worse, mixing them in makes the CPU
 * figures meaningless: a request that was killed stops accruing CPU, so its
 * number says where it was interrupted rather than what it wanted.
 */
const byStatus = await graphql(
  `
    query ($accountTag: String!, $since: Time!, $until: Time!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          workersInvocationsAdaptive(
            limit: 100
            filter: { datetime_geq: $since, datetime_leq: $until }
            orderBy: [sum_requests_DESC]
          ) {
            dimensions {
              scriptName
              status
            }
            sum {
              requests
            }
            quantiles {
              cpuTimeP50
              cpuTimeP99
              cpuTimeP999
            }
          }
        }
      }
    }
  `,
  { accountTag, since, until },
);

const rows = byStatus?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? [];

if (rows.length === 0) {
  console.log(`No Worker traffic in the last ${window}.`);
  process.exit(0);
}

// Cloudflare reports CPU in microseconds on this dataset.
const ms = (micro) => (micro == null ? null : micro / 1000);
const fmt = (value) => (value == null ? "    —  " : `${value.toFixed(1)}ms`.padStart(8));

console.log(`\nCloudflare · last ${window}\n`);

const scripts = [...new Set(rows.map((r) => r.dimensions.scriptName))];

for (const script of scripts) {
  const mine = rows.filter((r) => r.dimensions.scriptName === script);
  const total = mine.reduce((sum, r) => sum + r.sum.requests, 0);
  const failed = mine
    .filter((r) => r.dimensions.status !== "success")
    .reduce((sum, r) => sum + r.sum.requests, 0);

  console.log(`  ${script}  ·  ${total.toLocaleString()} requests`);
  console.log("    " + "status".padEnd(22) + "requests".padStart(9) + "   cpu p50   cpu p99  cpu p99.9");
  console.log("    " + "-".repeat(68));

  for (const row of mine) {
    const q = row.quantiles ?? {};
    console.log(
      "    " +
        (row.dimensions.status ?? "?").padEnd(22) +
        String(row.sum.requests).padStart(9) +
        "  " +
        fmt(ms(q.cpuTimeP50)) +
        "  " +
        fmt(ms(q.cpuTimeP99)) +
        "  " +
        fmt(ms(q.cpuTimeP999)),
    );
  }

  const rate = ((failed / Math.max(1, total)) * 100).toFixed(2);
  const perDay = Math.round(total / days);

  console.log(
    `\n    ${failed} failed (${rate}%) · ${perDay.toLocaleString()}/day, ` +
      `${((perDay / REQUESTS_PER_DAY) * 100).toFixed(1)}% of the ${REQUESTS_PER_DAY.toLocaleString()} allowed\n`,
  );
}

/*
 * WHEN the failures happened, which is usually the answer.
 *
 * Spread evenly, something is wrong with the app. Clustered into an hour or
 * two, it was whatever was being done at the time — a bulk re-crop, a testing
 * run — and normal use is fine. The difference decides whether the fix is
 * "rewrite a page" or "nothing".
 */
const failures = await graphql(
  `
    query ($accountTag: String!, $since: Time!, $until: Time!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          workersInvocationsAdaptive(
            limit: 200
            filter: {
              datetime_geq: $since
              datetime_leq: $until
              status: "exceededResources"
            }
            orderBy: [datetimeHour_ASC]
          ) {
            dimensions {
              datetimeHour
              scriptName
            }
            sum {
              requests
            }
          }
        }
      }
    }
  `,
  { accountTag, since, until },
);

const hours = failures?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? [];

if (hours.length === 0) {
  console.log("  No resource failures in this window.\n");
} else {
  console.log("  Resource failures, by hour (Pacific):\n");

  for (const hour of hours) {
    const when = new Date(hour.dimensions.datetimeHour).toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "short",
      day: "numeric",
      hour: "numeric",
    });

    console.log(
      `    ${String(hour.sum.requests).padStart(4)}  ${when}  ${hour.dimensions.scriptName}`,
    );
  }

  console.log("");
}
