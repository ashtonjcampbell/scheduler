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
 * WHAT THE FIRST RUN FOUND, and why this does not print a per-request limit:
 *
 * The received wisdom — and what this file said in its first draft — was that
 * a Worker gets 10ms of CPU and anything over that is Error 1102. The data
 * said otherwise even then: successful requests routinely reached 500ms of
 * CPU, while the requests that DID fail were cut off around 75ms. A single
 * ceiling cannot produce both. The 10ms figure is real but narrow — it is the
 * FREE plan's allowance for a cron trigger, which is what was stopping the
 * clock in September, not what stops a page.
 *
 * This account is on Workers Paid now, where a request gets 30 SECONDS of CPU
 * by default (raisable to 5 minutes via `limits.cpu_ms`). Nothing this app
 * does comes within three orders of magnitude of that, so CPU is no longer a
 * plausible reason for a request to be killed — `exceededResources` also
 * covers memory and startup time, and that is where to look instead.
 *
 * So the per-script tables report what happened rather than asserting a
 * threshold: how many requests failed, with what status, and how the CPU of
 * the failures compares to the CPU of everything that worked.
 *
 * What the paid plan does meter is volume, and the footer prices it: requests
 * and CPU for the month against the allowances the $5 already covers.
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

const token = env.CF_ANALYTICS_TOKEN;

if (!token) {
  console.error(
    "No CF_ANALYTICS_TOKEN in .env.local.\n\n" +
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

/*
 * Workers Paid, which is the plan this account is on. Published figures: the
 * $5 covers 10 million requests and 30 million CPU-milliseconds a month, and
 * anything beyond either allowance is charged at the rates below.
 *
 * Requests for static files are not billed and never appear in this dataset,
 * so these numbers are about the app's own work and nothing else.
 */
const PLAN = {
  subscription: 5.0,
  requestsIncluded: 10_000_000,
  perMillionRequests: 0.3,
  cpuMsIncluded: 30_000_000,
  perMillionCpuMs: 0.02,
};

/** A month, for projecting a one-day or one-week window forward. */
const DAYS_PER_MONTH = 30;

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

/*
 * Billing is per account, not per Worker, so the cost totals are taken across
 * every script rather than reported alongside each one.
 */
let accountRequests = 0;
let accountCpuMs = 0;

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

    accountRequests += row.sum.requests;
    // The API gives quantiles, not a total, so the median request stands in
    // for all of them. See the note on the cost block below.
    if (q.cpuTimeP50 != null) accountCpuMs += row.sum.requests * ms(q.cpuTimeP50);

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

  console.log(`\n    ${failed} failed (${rate}%) · ${perDay.toLocaleString()} requests/day\n`);
}

/*
 * What the month costs, projected from this window.
 *
 * Two things to hold in mind before believing a figure. A 24-hour read of a
 * quiet day says very little — use --week. And the CPU total is estimated
 * from the MEDIAN request, because this dataset reports quantiles rather than
 * a sum, so a long tail of slow pages would push the real number higher; the
 * p99 and p99.9 columns above are the warning that there is such a tail.
 */
const projectedRequests = Math.round((accountRequests / days) * DAYS_PER_MONTH);
const projectedCpuMs = Math.round((accountCpuMs / days) * DAYS_PER_MONTH);

const overage = (projected, included, perMillion) =>
  (Math.max(0, projected - included) / 1_000_000) * perMillion;

const requestCost = overage(projectedRequests, PLAN.requestsIncluded, PLAN.perMillionRequests);
const cpuCost = overage(projectedCpuMs, PLAN.cpuMsIncluded, PLAN.perMillionCpuMs);
const share = (projected, included) => `${((projected / included) * 100).toFixed(2)}%`;

console.log(`  Workers Paid · projected over ${DAYS_PER_MONTH} days\n`);
console.log(
  `    requests  ${projectedRequests.toLocaleString().padStart(14)}    ` +
    `of ${PLAN.requestsIncluded.toLocaleString()} included  (${share(projectedRequests, PLAN.requestsIncluded)})`,
);
console.log(
  `    cpu       ${projectedCpuMs.toLocaleString().padStart(14)}ms  ` +
    `of ${PLAN.cpuMsIncluded.toLocaleString()}ms included  (${share(projectedCpuMs, PLAN.cpuMsIncluded)})`,
);

const extra = requestCost + cpuCost;

console.log(
  extra > 0
    ? `\n    $${PLAN.subscription.toFixed(2)} subscription + $${requestCost.toFixed(2)} requests + ` +
        `$${cpuCost.toFixed(2)} cpu = $${(PLAN.subscription + extra).toFixed(2)}/month\n`
    : `\n    $${PLAN.subscription.toFixed(2)}/month, with nothing over either allowance\n`,
);

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
