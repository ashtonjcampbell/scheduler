/**
 * The retrying fetch does what it says.
 *
 * Written because the two failures it exists for — a gateway timeout and a
 * token one second ahead of the database's clock — cannot be reproduced on
 * demand. A fake fetch is the only way to see this code run at all.
 */

import assert from "node:assert/strict";
import { retryingFetch } from "../src/lib/supabase/retry";

let failures = 0;

function check(name: string, run: () => Promise<void>) {
  return run().then(
    () => console.log(`  ok   ${name}`),
    (error) => {
      failures++;
      console.error(`  FAIL ${name}\n       ${(error as Error).message}`);
    },
  );
}

/** Stands in for the network: returns each scripted reply in turn. */
function scripted(replies: Array<Response | Error>) {
  const calls: string[] = [];

  const fake = (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push((init?.method ?? "GET").toUpperCase());
    const next = replies[calls.length - 1] ?? replies[replies.length - 1]!;
    return next instanceof Error
      ? Promise.reject(next)
      : Promise.resolve(next.clone());
  };

  return { fake, calls };
}

const original = globalThis.fetch;

async function withFetch<T>(
  fake: typeof fetch,
  run: () => Promise<T>,
): Promise<T> {
  globalThis.fetch = fake;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

const skew = () =>
  new Response(JSON.stringify({ message: "JWT issued at future" }), {
    status: 401,
  });

const ok = () => new Response("[]", { status: 200 });

async function main() {
  console.log("retrying fetch");

  await check("a token issued in the future is tried again", async () => {
    const { fake, calls } = scripted([skew(), ok()]);
    const response = await withFetch(fake as typeof fetch, () =>
      retryingFetch("https://x/rest"),
    );

    assert.equal(
      response.status,
      200,
      "should end up with the successful reply",
    );
    assert.equal(calls.length, 2, "should have asked twice");
  });

  await check("a gateway timeout is tried again", async () => {
    const { fake, calls } = scripted([new Response("", { status: 504 }), ok()]);
    const response = await withFetch(fake as typeof fetch, () =>
      retryingFetch("https://x/rest"),
    );

    assert.equal(response.status, 200);
    assert.equal(calls.length, 2);
  });

  await check("a real expired session is NOT tried again", async () => {
    const expired = new Response(JSON.stringify({ message: "JWT expired" }), {
      status: 401,
    });
    const { fake, calls } = scripted([expired, ok()]);
    const response = await withFetch(fake as typeof fetch, () =>
      retryingFetch("https://x/rest"),
    );

    assert.equal(
      response.status,
      401,
      "should surface the 401 rather than hiding it",
    );
    assert.equal(calls.length, 1, "should not have delayed the login screen");
  });

  await check("a bad request is NOT tried again", async () => {
    const { fake, calls } = scripted([new Response("", { status: 400 }), ok()]);
    const response = await withFetch(fake as typeof fetch, () =>
      retryingFetch("https://x/rest"),
    );

    assert.equal(response.status, 400);
    assert.equal(calls.length, 1);
  });

  await check("a write is NOT repeated on a 5xx", async () => {
    const { fake, calls } = scripted([new Response("", { status: 502 }), ok()]);
    const response = await withFetch(fake as typeof fetch, () =>
      retryingFetch("https://x/rest", { method: "POST" }),
    );

    assert.equal(
      response.status,
      502,
      "a failed write must fail, not silently double",
    );
    assert.equal(calls.length, 1);
  });

  await check("it gives up rather than looping for ever", async () => {
    const { fake, calls } = scripted([new Response("", { status: 503 })]);
    const response = await withFetch(fake as typeof fetch, () =>
      retryingFetch("https://x/rest"),
    );

    assert.equal(response.status, 503, "the last failure should be returned");
    assert.equal(calls.length, 3, "one attempt plus two retries");
  });

  await check("the body survives being inspected", async () => {
    const { fake } = scripted([
      skew(),
      new Response('[{"id":"abc"}]', { status: 200 }),
    ]);
    const response = await withFetch(fake as typeof fetch, () =>
      retryingFetch("https://x/rest"),
    );

    assert.equal(
      await response.text(),
      '[{"id":"abc"}]',
      "caller must still be able to read it",
    );
  });

  if (failures > 0) {
    console.error(`\n${failures} check${failures === 1 ? "" : "s"} failed.`);
    process.exit(1);
  }

  console.log("\nAll good.");
}

main();
