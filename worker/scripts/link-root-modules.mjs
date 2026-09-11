/**
 * Make the app modules the worker borrows able to find their own dependencies.
 *
 * `publish.ts` imports the queue logic from `src/lib`, deliberately, so the
 * worker and the app can never disagree about whose turn it is. But those
 * shared modules import `date-fns` and `@date-fns/tz`, and Node resolves an
 * import by walking up from the importing FILE — so from `src/lib/time.ts`
 * that means the repo root, never `worker/node_modules`.
 *
 * In GitHub Actions only `worker/` is installed, so the root has nothing and
 * every publish run died with "Cannot find module '@date-fns/tz'" before
 * reaching any code that could log the failure. A local checkout has the root
 * installed, which hides the problem completely.
 *
 * Point the root at the worker's tree. Both packages are already worker
 * dependencies pinned by `worker/package-lock.json`, so this adds no second
 * install to drift out of step with the first.
 *
 * This lives in the worker's own scripts rather than in each workflow so a new
 * workflow cannot forget it.
 */

import { existsSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(workerDir, "..");

const rootModules = join(repoRoot, "node_modules");
const workerModules = join(workerDir, "node_modules");

if (existsSync(rootModules)) {
  // A normal development checkout: the root is installed for real.
  process.exit(0);
}

if (!existsSync(workerModules)) {
  console.error("worker/node_modules is missing — run npm ci in worker/ first.");
  process.exit(1);
}

try {
  // "junction" is the Windows type that works without elevated privileges; it
  // is ignored on every other platform.
  symlinkSync(workerModules, rootModules, "junction");
  console.log("Linked the repo root at worker/node_modules.");
} catch (error) {
  // A parallel job may have won the race, which is fine — the link is there.
  if (!existsSync(rootModules)) throw error;
}
