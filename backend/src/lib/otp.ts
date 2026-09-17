import { randomInt } from "crypto"

/**
 * A six-digit code for email verification and password reset.
 *
 * `randomInt` rather than `Math.random()`, which is what all four call sites used. V8's
 * `Math.random` is xorshift128+: fast and fine for shuffling, but not a CSPRNG, and its
 * state can be recovered from enough observed outputs. The rate limiters keep guessing a
 * code impractical either way; there is no reason for the code itself to be predictable
 * as well. `lib/prizeCode` already made the same choice.
 *
 * The upper bound is exclusive, so this spans 100000-999999: always six digits, never a
 * leading zero for an email client to strip.
 */
export const generateOtp = (): string => randomInt(100_000, 1_000_000).toString()
