import { vi } from "vitest"

type Entry = { value: string; expiresAt: number }

/**
 * Enough of ioredis for the idempotency middleware: `SET` with `EX` and `NX`,
 * `GET`, and `DEL`.
 *
 * A stub rather than a live Redis because the behaviour under test is the
 * middleware's, not Redis's — whether a second request sees the reservation
 * the first one made. Keeping it in memory also makes the failure cases
 * (unreachable, slow) something a test can ask for directly, which a real
 * server will not do on request.
 */
const createRedisStub = () => {
  const store = new Map<string, Entry>()

  /** Set to a rejecting or hanging behaviour to exercise the fail-open path. */
  let mode: "ok" | "down" | "hang" = "ok"

  const guard = async <T>(work: () => T): Promise<T> => {
    if (mode === "down") throw new Error("Connection is closed.")
    if (mode === "hang") await new Promise(() => {})
    return work()
  }

  const live = (key: string): Entry | undefined => {
    const entry = store.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= Date.now()) {
      store.delete(key)
      return undefined
    }
    return entry
  }

  const redis = {
    get: (key: string) => guard(() => live(key)?.value ?? null),

    set: (key: string, value: string, ...args: unknown[]) =>
      guard(() => {
        const flags = args.map((a) => String(a).toUpperCase())
        const exIndex = flags.indexOf("EX")
        const ttlSeconds = exIndex >= 0 ? Number(args[exIndex + 1]) : 0

        if (flags.includes("NX") && live(key)) return null

        store.set(key, {
          value,
          expiresAt: ttlSeconds
            ? Date.now() + ttlSeconds * 1000
            : Number.MAX_SAFE_INTEGER,
        })
        return "OK"
      }),

    del: (key: string) => guard(() => (store.delete(key) ? 1 : 0)),

    // rate-limit-redis reaches Redis through this. No test should be hitting a
    // rate limiter, so make it obvious rather than silently returning nothing.
    call: () => {
      throw new Error(
        "Redis `call` is not stubbed: a test hit a rate limiter. Mount the " +
          "route without its limiter, or extend the stub.",
      )
    },

    on: vi.fn(),
    quit: vi.fn(async () => "OK"),
  }

  return {
    redis,
    /** Make every subsequent call reject, as an unreachable server would. */
    goDown: () => {
      mode = "down"
    },
    /** Make every subsequent call never settle, so the timeout path runs. */
    hang: () => {
      mode = "hang"
    },
    recover: () => {
      mode = "ok"
    },
    clear: () => store.clear(),
    keys: () => [...store.keys()],
  }
}

/**
 * A single instance per test file, so a `vi.mock` factory and the test body
 * can both reach it through a plain import. Handing the instance back out of
 * the factory would need a top-level await, which this tsconfig rejects.
 */
export const redisStub = createRedisStub()
