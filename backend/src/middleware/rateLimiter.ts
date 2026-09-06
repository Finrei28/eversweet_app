import { Request } from "express"
import { ipKeyGenerator, rateLimit } from "express-rate-limit"
import { RedisReply, RedisStore } from "rate-limit-redis"
import { redis as redisClient } from "../lib/redis"

const makeStore = (prefix: string) =>
  new RedisStore({
    prefix,
    // Explicitly cast the promise to RedisReply
    sendCommand: (...args: string[]) =>
      redisClient.call(args[0], ...args.slice(1)) as Promise<RedisReply>,
  })

// Track the email from the body instead of the IP, falling back to the IP
// when the request doesn't carry one.
const emailKeyGenerator = (req: Request): string => {
  const userName = req.body?.email ?? req.body?.username
  return typeof userName === "string"
    ? userName.toLowerCase().trim()
    : ipKeyGenerator(req.ip ?? "")
}

// ==========================================
// TIER 1: IP-Based Limiters (Infrastructure)
// ==========================================

// 1A. Short IP Window: Stops rapid script blasting
export const ipShortLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 5, // Max 5 requests per minute from this IP
  standardHeaders: true, // 🟢 CRUCIAL: Sends RateLimit-Limit and RateLimit-Remaining headers
  legacyHeaders: false, // 🟢 Disables old, non-standard X-RateLimit headers
  store: makeStore("rate-limit:login:ip-short:"),
  message: {
    status: 429,
    error: "Too many requests. Try again in a few minutes.",
  },
})

// 1B. Long IP Window: Stops a single IP crawling accounts all day
export const ipLongLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 100, // Max 100 total login attempts a day from this IP
  standardHeaders: true, // 🟢 CRUCIAL: Sends RateLimit-Limit and RateLimit-Remaining headers
  legacyHeaders: false, // 🟢 Disables old, non-standard X-RateLimit headers
  store: makeStore("rate-limit:login:ip-long:"),
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
  store: makeStore("rate-limit:login:username-medium:"),
  keyGenerator: emailKeyGenerator,
  message: {
    status: 429,
    error: "This account has been temporarily locked for 15 minutes.",
  },
})

// 2B. Long Email Window: Catches ultra-slow, sneaky automated bots
export const userNameLongLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 20, // Max 20 attempts on one account per day
  skipSuccessfulRequests: true,
  standardHeaders: true, // 🟢 CRUCIAL: Sends RateLimit-Limit and RateLimit-Remaining headers
  legacyHeaders: false, // 🟢 Disables old, non-standard X-RateLimit headers
  store: makeStore("rate-limit:login:username-long:"),
  keyGenerator: emailKeyGenerator,
  message: {
    status: 429,
    error: "Too many failed attempts today. Account locked for 24 hours.",
  },
})

// ==========================================
// TIER 3: OTP / Account Recovery Limiters
// ==========================================
// Endpoints that mail a code answer 200 whether or not the address exists, so
// they can't leak who is registered. That also means skipSuccessfulRequests
// would never count anything — this one counts every request, or an attacker
// could bury someone's inbox (and burn the mail quota) for free.
export const verificationEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // Max 5 codes mailed to one address per hour
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore("rate-limit:verification-email:"),
  keyGenerator: emailKeyGenerator,
  message: {
    status: 429,
    error: "Too many codes requested. Please try again later.",
  },
})

// Both codes are only 6 digits, so an unthrottled verify endpoint can be
// walked in minutes — and /checkVerificationCode hands back a 90 day JWT. These
// sit on the password reset and email verification routes and only count
// failures, so a user who types the right code is never penalised. The routes
// share counters on purpose: an attacker poking at any end of account recovery
// draws down one budget. They're kept off the rate-limit:login:* prefixes so
// customer traffic can't lock staff out of the admin sign-in.

// 3A. Short IP Window: stops rapid guessing from one machine
export const otpIpShortLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // Max 10 verification attempts per minute from this IP
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore("rate-limit:otp:ip-short:"),
  message: {
    status: 429,
    error: "Too many attempts. Try again in a few minutes.",
  },
})

// 3B. Long IP Window: stops a botnet node grinding codes all day
export const otpIpLongLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 100, // Max 100 verification attempts a day from this IP
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore("rate-limit:otp:ip-long:"),
  message: {
    status: 429,
    error: "Daily request limit exceeded for this network.",
  },
})

// 3C. Email Window: matches the 15 minute OTP lifetime, so a code can only
// ever absorb 5 guesses before it expires.
export const otpEmailMediumLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Max 5 wrong codes per email address
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore("rate-limit:otp:email-medium:"),
  keyGenerator: emailKeyGenerator,
  message: {
    status: 429,
    error:
      "Too many incorrect codes. Please wait 15 minutes and request a new code.",
  },
})

// 3D. Long Email Window: catches slow guessing spread across many codes
export const otpEmailLongLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 20, // Max 20 wrong codes on one account per day
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore("rate-limit:otp:email-long:"),
  keyGenerator: emailKeyGenerator,
  message: {
    status: 429,
    error: "Too many incorrect codes today. Please try again in 24 hours.",
  },
})
