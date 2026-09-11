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

    /**
     * rate-limit-redis reaches Redis through this.
     *
     * It talks in Lua: `SCRIPT LOAD` to register its increment script, then
     * `EVALSHA <sha> 1 <key> <windowMs>` per request, expecting back a
     * [totalHits, msUntilReset] pair. Rather than run Lua, this keeps the same
     * counter the script would and answers in the same shape — enough for a
     * test to prove a limiter is mounted, keyed on what it should be, and
     * eventually says 429.
     *
     * This used to throw on the grounds that no test should hit a limiter.
     * That stopped being true once routes existed whose limiter placement is
     * itself load-bearing: the prize code limiters sit *after* authenticateToken
     * so they key on the staff account rather than the shop's single IP, and
     * mounting the routes without them would test right past that.
     */
    call: (...args: unknown[]) =>
      guard(() => {
        const [command, ...rest] = args.map((a) => String(a))

        if (command.toUpperCase() === "SCRIPT") return "stub-script-sha"

        if (command.toUpperCase() === "EVALSHA") {
          // [sha, numKeys, key, windowMs]
          const key = rest[2]
          const windowMs = Number(rest[3]) || 60_000

          const entry = live(key)
          const hits = entry ? Number(entry.value) + 1 : 1
          const expiresAt = entry
            ? entry.expiresAt
            : Date.now() + windowMs

          store.set(key, { value: String(hits), expiresAt })
          return [hits, Math.max(0, expiresAt - Date.now())]
        }

        if (command.toUpperCase() === "DEL") return store.delete(rest[0]) ? 1 : 0
        if (command.toUpperCase() === "DECR") {
          const entry = live(rest[0])
          if (!entry) return 0
          const hits = Number(entry.value) - 1
          store.set(rest[0], { ...entry, value: String(hits) })
          return hits
        }

        throw new Error(`Redis \`call\` stub does not know ${command}`)
      }),

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
