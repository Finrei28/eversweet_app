import { Request } from "express"
import { rateLimit } from "express-rate-limit"
import { RedisReply, RedisStore } from "rate-limit-redis"
import Redis from "ioredis"

// Connect to your Redis instance
const redisUrl = process.env.REDIS_URL!
const redisClient = new Redis(redisUrl)

redisClient.on("error", (err) => console.log("Redis Error:", err))

// ==========================================
// TIER 1: IP-Based Limiters (Infrastructure)
// ==========================================

// 1A. Short IP Window: Stops rapid script blasting
export const ipShortLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 5, // Max 5 requests per minute from this IP
  standardHeaders: true, // 🟢 CRUCIAL: Sends RateLimit-Limit and RateLimit-Remaining headers
  legacyHeaders: false, // 🟢 Disables old, non-standard X-RateLimit headers
  store: new RedisStore({
    // 2. Explicitly cast the promise to RedisReply
    sendCommand: (...args: string[]) =>
      redisClient.call(args[0], ...args.slice(1)) as Promise<RedisReply>,
  }),
  message: { status: 429, error: "Too many requests. Slow down." },
})

// 1B. Long IP Window: Stops a single IP crawling accounts all day
export const ipLongLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 100, // Max 100 total login attempts a day from this IP
  standardHeaders: true, // 🟢 CRUCIAL: Sends RateLimit-Limit and RateLimit-Remaining headers
  legacyHeaders: false, // 🟢 Disables old, non-standard X-RateLimit headers
  store: new RedisStore({
    // 2. Explicitly cast the promise to RedisReply
    sendCommand: (...args: string[]) =>
      redisClient.call(args[0], ...args.slice(1)) as Promise<RedisReply>,
  }),
  message: {
    status: 429,
    error: "Daily request limit exceeded for this network.",
  },
})

// ==========================================
// TIER 2: Email-Based Limiters (Account Lock)
// ==========================================

// 2A. Standard Email Window: Blocks targeted brute-force
export const userNameMediumLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Max 5 failed attempts per email address
  skipSuccessfulRequests: true,
  standardHeaders: true, // 🟢 CRUCIAL: Sends RateLimit-Limit and RateLimit-Remaining headers
  legacyHeaders: false, // 🟢 Disables old, non-standard X-RateLimit headers
  store: new RedisStore({
    sendCommand: (...args: string[]) =>
      redisClient.call(args[0], ...args.slice(1)) as Promise<RedisReply>,
  }),
  // Crucial: Tell the limiter to track the email from the body instead of the IP
  keyGenerator: (req: Request): string => {
    const userName = req.body?.email ?? req.body?.username
    return typeof userName === "string"
      ? userName.toLowerCase().trim()
      : (req.ip ?? "")
  },
  message: {
    status: 429,
    error: "This account has been temporarily locked. Try again in 15 minutes.",
  },
})

// 2B. Long Email Window: Catches ultra-slow, sneaky automated bots
export const userNameLongLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 20, // Max 20 attempts on one account per day
  skipSuccessfulRequests: true,
  standardHeaders: true, // 🟢 CRUCIAL: Sends RateLimit-Limit and RateLimit-Remaining headers
  legacyHeaders: false, // 🟢 Disables old, non-standard X-RateLimit headers
  store: new RedisStore({
    sendCommand: (...args: string[]) =>
      redisClient.call(args[0], ...args.slice(1)) as Promise<RedisReply>,
  }),
  keyGenerator: (req: Request): string => {
    const userName = req.body?.email ?? req.body?.username
    return typeof userName === "string"
      ? userName.toLowerCase().trim()
      : (req.ip ?? "")
  },
  message: {
    status: 429,
    error: "Too many failed attempts today. Account locked for 24 hours.",
  },
})
