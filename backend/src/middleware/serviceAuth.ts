import { createHash, timingSafeEqual } from "crypto"
import { NextFunction, Request, Response } from "express"

export const SERVICE_SECRET_HEADER = "x-service-secret"

/**
 * Compares two secrets without leaking, through timing, how much of one
 * matched. Both are hashed to a fixed width first: `timingSafeEqual` throws on
 * a length mismatch, and branching on length before comparing would itself
 * tell an attacker when they had guessed the right size.
 */
const secretsMatch = (given: string, expected: string): boolean => {
  const a = createHash("sha256").update(given).digest()
  const b = createHash("sha256").update(expected).digest()
  return timingSafeEqual(a, b)
}

/**
 * Guards the routes only our own servers may call.
 *
 * These carry no user session — the website announces an order it has already
 * taken payment for, as itself — so a shared secret is the credential. It is
 * checked against `INTERNAL_SERVICE_SECRET`, and an unset variable refuses
 * every request rather than waving them through: a misconfigured deploy must
 * fail closed, since this route reaches the kitchen screen.
 */
export const authenticateService = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const expected = process.env.INTERNAL_SERVICE_SECRET

  if (!expected) {
    console.error(
      "INTERNAL_SERVICE_SECRET is unset; refusing internal request to " +
        req.originalUrl,
    )
    res.status(401).json({ message: "Unauthorised" })
    return
  }

  const given = req.headers[SERVICE_SECRET_HEADER]

  if (typeof given !== "string" || !given || !secretsMatch(given, expected)) {
    res.status(401).json({ message: "Unauthorised" })
    return
  }

  next()
}
