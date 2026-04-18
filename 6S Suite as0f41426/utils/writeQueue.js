// utils/writeQueue.js
// A tiny, per-key async queue to serialize writes and avoid JSON corruption.
// Adds: timeout failsafe, multi-key critical sections (deadlock-safe), and small diagnostics.

const queues = new Map(); // key -> Promise that represents the tail of the queue

/**
 * Internal helper: race a promise with a timeout.
 * We can't cancel the underlying work in Node (without AbortSignals),
 * but timing out unblocks the queue so future tasks aren't starved forever.
 */
function withTimeout(promise, ms, label = 'queue') {
  if (!ms || ms <= 0) return promise;
  let timer;
  const timeoutErr = new Error(`QUEUE_TIMEOUT: ${label} exceeded ${ms}ms`);
  timeoutErr.code = 'QUEUE_TIMEOUT';
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(timeoutErr), ms);
    }),
  ]);
}

/**
 * Enqueue an async task keyed by `key` (usually an absolute filepath).
 * Tasks for the same key run strictly one after another.
 *
 * @param {string} key
 * @param {() => Promise<any>} task
 * @param {{ timeoutMs?: number, label?: string }} [opts]
 * @returns {Promise<any>} result of the task (or rejection on error/timeout)
 */
export async function withQueue(key, task, opts = {}) {
  const prev = queues.get(key) || Promise.resolve();

  let resolveNext, rejectNext;
  const gate = new Promise((res, rej) => {
    resolveNext = res;
    rejectNext = rej;
  });

  // Chain a new tail that waits for the previous tail to settle, then runs our task
  const tail = prev
    .catch(() => {}) // swallow previous errors so the chain continues
    .then(async () => {
      try {
        const result = await withTimeout(Promise.resolve().then(task), opts.timeoutMs, opts.label || key);
        resolveNext(result);
        return result;
      } catch (err) {
        rejectNext(err);
        throw err;
      }
    });

  // The head visible to subsequent enqueues is our "gate" promise (resolves/rejects when task finishes),
  // ensuring strict sequencing even if the task throws or times out.
  queues.set(key, gate);

  try {
    return await tail;
  } finally {
    // If we're still the head for this key, clear it.
    // Another task may already have replaced it with its own gate.
    if (queues.get(key) === gate) queues.delete(key);
  }
}

/**
 * Acquire multiple keys atomically (critical section) in a **deadlock-safe** way.
 * We reserve all keys in a **sorted** order to ensure every caller uses the same sequence.
 *
 * NOTE: While a timeout will unblock the queue, the underlying task still runs in the background.
 * Keep tasks small and I/O bound; prefer using your own cancellation primitives when possible.
 *
 * @param {string[]} keys
 * @param {() => Promise<any>} task
 * @param {{ timeoutMs?: number, label?: string }} [opts]
 * @returns {Promise<any>}
 */
export async function withQueueMulti(keys, task, opts = {}) {
  if (!Array.isArray(keys) || keys.length === 0) {
    return withQueue('<<global>>', task, opts);
  }

  // De-dup and sort keys to enforce a global acquisition order.
  const uniqSorted = Array.from(new Set(keys)).sort();

  // Reserve each key by appending a "gate" promise to its tail.
  const reservations = [];
  const releases = [];

  for (const key of uniqSorted) {
    const prev = queues.get(key) || Promise.resolve();

    let resolveGate, rejectGate;
    const gate = new Promise((res, rej) => {
      resolveGate = res;
      rejectGate = rej;
    });

    queues.set(
      key,
      prev
        .catch(() => {})
        .then(() => gate)
    );

    // We will resolve/reject this gate once our critical section completes.
    reservations.push(prev);
    releases.push(() => {
      // Resolve the gate to let the next waiter run.
      resolveGate();
      if (queues.get(key) === gate) queues.delete(key);
    });
  }

  // Wait for all previous tails to finish (the section is now exclusively reserved).
  await Promise.all(reservations).catch(() => {});

  try {
    return await withTimeout(Promise.resolve().then(task), opts.timeoutMs, opts.label || uniqSorted.join('|'));
  } finally {
    // Release in reverse order (not strictly necessary but conventional).
    for (let i = releases.length - 1; i >= 0; i--) {
      try { releases[i](); } catch { /* ignore */ }
    }
  }
}

/**
 * Small diagnostic: how many keys are currently queued.
 * @returns {number}
 */
export function queuedKeyCount() {
  return queues.size;
}

/**
 * Return a shallow snapshot of keys currently in the queue (for debugging/logging).
 * @returns {string[]}
 */
export function queuedKeys() {
  return Array.from(queues.keys());
}
