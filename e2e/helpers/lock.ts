import fs from "fs";
import os from "os";
import path from "path";

/**
 * A whole-suite mutex.
 *
 * The suite is `workers: 1` against ONE shared local Postgres, and global setup
 * begins by calling `cleanupAll()` — which deletes every `@forecast.test` auth
 * user. So a second run starting while the first is mid-flight deletes the
 * logged-in users out from under it. The result is not a clean failure: it is a
 * scatter of unrelated-looking errors that never repeat the same way twice —
 * a 502 from Kong here, a missing row there, a redirect to /login somewhere
 * else — and it reads exactly like an inherently flaky suite. It isn't one.
 *
 * (Two agents working in the same checkout is the usual way this happens, but
 * so is a forgotten `npm run test:e2e` in another terminal tab.)
 *
 * The lock is a PID file rather than a database lock on purpose: PostgREST
 * hands out a connection per request, so a session-scoped
 * `pg_try_advisory_lock` would be released the instant the request returned.
 */

const LOCK_PATH = path.resolve(__dirname, "../../.e2e-lock");

interface LockFile {
  pid: number;
  startedAt: string;
  host: string;
}

function readLock(): LockFile | null {
  try {
    return JSON.parse(fs.readFileSync(LOCK_PATH, "utf8")) as LockFile;
  } catch {
    // Missing, unreadable, or half-written — all mean "no usable lock".
    return null;
  }
}

/** Is that process still alive? Signal 0 tests existence without signalling. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH is the only code that means "no such process". EPERM means the
    // process very much exists, it just belongs to another user — treating that
    // as dead would clear a live lock, which is the one thing this must not do.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Claim the suite for this process, or refuse to start.
 *
 * A lock left behind by a crashed or killed run is detected by checking whether
 * its PID still exists, so a hard `^C` never wedges the suite permanently.
 */
export function acquireSuiteLock(): void {
  const existing = readLock();

  if (existing && existing.pid !== process.pid && isAlive(existing.pid)) {
    const ageSeconds = Math.round(
      (Date.now() - new Date(existing.startedAt).getTime()) / 1000
    );
    throw new Error(
      `REFUSING TO RUN: another E2E run is already in progress (pid ${existing.pid}, ` +
        `started ${ageSeconds}s ago on ${existing.host}).\n\n` +
        `Both runs share one local Postgres, and global setup DELETES every fixture ` +
        `user before seeding — so starting now would pull the logged-in users out from ` +
        `under the run already going, and both would fail in confusing, ` +
        `non-reproducible ways.\n\n` +
        `Wait for it to finish, or stop it with \`kill ${existing.pid}\`. If you are ` +
        `certain that process is dead, delete ${LOCK_PATH}.`
    );
  }

  if (existing && !isAlive(existing.pid)) {
    console.log(
      `[e2e] clearing a stale lock from pid ${existing.pid} (process is gone)`
    );
  }

  const lock: LockFile = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    host: os.hostname(),
  };
  fs.writeFileSync(LOCK_PATH, JSON.stringify(lock, null, 2));
}

/** Release the lock, but only if it is still ours. */
export function releaseSuiteLock(): void {
  const existing = readLock();
  if (existing && existing.pid !== process.pid) {
    // Someone else's lock: a stale-lock takeover raced us. Leave it alone —
    // deleting it would strand whoever holds it now.
    return;
  }
  try {
    fs.unlinkSync(LOCK_PATH);
  } catch {
    // Already gone. Nothing to do.
  }
}
