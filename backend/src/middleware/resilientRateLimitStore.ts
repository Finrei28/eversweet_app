import {
  MemoryStore,
  type ClientRateLimitInfo,
  type IncrementResponse,
  type Options,
  type Store,
} from "express-rate-limit"
import { RedisStore, type RedisReply } from "rate-limit-redis"

import { redis as redisClient } from "../lib/redis"
import { getErrorMessage } from "../utils/getError"

/**
 * A rate-limit store that uses Redis while Redis answers, and counts in memory when it
 * does not.
 *
 * Every limiter used to talk to `RedisStore` directly, which broke the rule the rest of
 * this codebase keeps — Redis is an accelerator, never a dependency — in three ways:
 *
 * 1. **An unavailable Redis failed every limited request with a 500.** express-rate-limit
 *    turns a store error into a thrown error, so sign-in, sign-up, OTPs, the website's order
 *    announcement and the prize code endpoints all went down with it.
 * 2. **Each of those requests hung first.** Nothing bounded the call, so ioredis queued the
 *    command and retried it twenty times before giving up.
 * 3. **A Redis blip at boot broke limiting until the process restarted.** `RedisStore.init`
 *    caches the *promise* of loading its Lua scripts. If that promise rejects it stays
 *    rejected, every later request awaits it and throws, and the store only ever reloads a
 *    script on a `NOSCRIPT` reply — which a rejected promise never produces. Redis could come
 *    back within seconds and the limiters would still be failing hours later.
 *
 * The direction this fails in is the point. Falling back to *no* limit
 * (`passOnStoreError`) would hand a Redis outage straight to anyone brute-forcing a sign-in
 * or walking the prize code space. Falling back to memory keeps every limit in force, per
 * process: with more than one instance a client can get the limit once per instance for
 * the length of the outage, which is a far smaller door than an open one. Counts do not
 * carry across the switch in either direction, so a client may get a fresh window when
 * Redis goes down or comes back.
 */

/**
 * An `EVALSHA` over a few bytes. The round trip to Redis is about 30ms (see `lib/cache`), so
 * anything near this means Redis is genuinely unwell. Short, because every limited request
 * waits on it before doing anything else.
 */
const COMMAND_TIMEOUT_MS = 500

/**
 * How long to stop asking Redis after it fails. Without this, every request during an
 * outage would spend the timeout finding out again. After the cooldown one request probes,
 * and the others waiting at that moment share its answer.
 */
const COOLDOWN_MS = 10_000

/** Like `bounded` in `lib/cache`, but rejects: a store has to know it failed to fall back. */
const withTimeout = <T>(work: Promise<T>, timeoutMs: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Redis did not answer within ${timeoutMs}ms`)),
      timeoutMs,
    )
    timer.unref?.()

    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })

export class ResilientStore implements Store {
  readonly prefix: string

  /** Counts live in Redis whenever they can, so they are shared across processes. */
  readonly localKeys = false

  private readonly redisStore: RedisStore
  private readonly memoryStore = new MemoryStore()
  private readonly cooldownMs: number

  private options: Options | undefined
  /** Whether the Lua scripts are loaded. Cleared on any failure, so recovery reloads them. */
  private scriptsLoaded = false
  /** One script load at a time, however many requests arrive while it runs. */
  private loading: Promise<boolean> | null = null
  private redisDownUntil = 0
  /** For logging the change of state once, not once per request. */
  private degraded = false

  constructor(
    prefix: string,
    {
      timeoutMs = COMMAND_TIMEOUT_MS,
      cooldownMs = COOLDOWN_MS,
    }: { timeoutMs?: number; cooldownMs?: number } = {},
  ) {
    this.prefix = prefix
    this.cooldownMs = cooldownMs
    this.redisStore = new RedisStore({
      prefix,
      sendCommand: (...args: string[]) =>
        withTimeout(
          redisClient.call(args[0], ...args.slice(1)) as Promise<RedisReply>,
          timeoutMs,
        ),
    })
  }

  init(options: Options) {
    this.options = options
    this.memoryStore.init(options)
    // Not awaited: express-rate-limit does not wait on init, and a limiter must be usable
    // whether or not Redis is there when the process starts.
    void this.redisReady()
  }

  async increment(key: string): Promise<IncrementResponse> {
    if (await this.redisReady()) {
      try {
        return await this.redisStore.increment(key)
      } catch (error) {
        this.markDown(error)
      }
    }
    return this.memoryStore.increment(key)
  }

  /**
   * `skipSuccessfulRequests` un-counts a request once its response succeeds. It goes to
   * whichever store is in use at that moment, so a request counted in memory that finishes
   * just after Redis recovers is un-counted in Redis instead. At worst that is one success
   * still counted, or a `DECR` on a key Redis never had — and the increment script resets
   * an unexpiring key on its next hit.
   */
  async decrement(key: string): Promise<void> {
    if (await this.redisReady()) {
      try {
        await this.redisStore.decrement(key)
        return
      } catch (error) {
        this.markDown(error)
      }
    }
    await this.memoryStore.decrement(key)
  }

  /** Both, so a reset holds whichever store answers the client's next request. */
  async resetKey(key: string): Promise<void> {
    await this.memoryStore.resetKey(key)
    if (await this.redisReady()) {
      try {
        await this.redisStore.resetKey(key)
      } catch (error) {
        this.markDown(error)
      }
    }
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    if (await this.redisReady()) {
      try {
        return await this.redisStore.get(key)
      } catch (error) {
        this.markDown(error)
      }
    }
    return this.memoryStore.get(key)
  }

  shutdown() {
    this.memoryStore.shutdown()
  }

  /** Whether to use Redis for this call: never inside a cooldown, and only with scripts loaded. */
  private async redisReady(): Promise<boolean> {
    if (Date.now() < this.redisDownUntil) return false
    if (this.scriptsLoaded) return true
    if (!this.options) return false

    this.loading ??= this.loadScripts().finally(() => {
      this.loading = null
    })
    return this.loading
  }

  /**
   * Calls `RedisStore.init` again rather than trusting the promise it cached. That cached
   * promise is what kept a failed boot failing forever.
   */
  private async loadScripts(): Promise<boolean> {
    try {
      await this.redisStore.init(this.options!)
      this.scriptsLoaded = true
      if (this.degraded) {
        this.degraded = false
        console.log(`Rate limiter ${this.prefix} is using Redis again.`)
      }
      return true
    } catch (error) {
      this.markDown(error)
      return false
    }
  }

  private markDown(error: unknown) {
    this.scriptsLoaded = false
    this.redisDownUntil = Date.now() + this.cooldownMs

    if (!this.degraded) {
      this.degraded = true
      console.error(
        `Rate limiter ${this.prefix} cannot reach Redis, counting in memory until it can:`,
        getErrorMessage(error),
      )
    }
  }
}
