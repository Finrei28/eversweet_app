import jwt from "jsonwebtoken"

import { db } from "./db"
import { cachedSession, rememberSession } from "./sessionCache"

export type Session = { userId: string; role: string }

/**
 * Who a token belongs to and what they may do, or null when it must not be honoured.
 *
 * The one definition for the HTTP middleware and the socket handshake, which used to
 * disagree. The middleware retired tokens issued before a password reset; the socket
 * only checked the signature. So resetting a stolen admin password shut the thief out
 * of the API while their socket went on receiving every order — customer names, emails
 * and phone numbers — until the token ran out. And both took the role from the token,
 * which is fixed for its whole 90 or 180 day life, so demoting an admin changed nothing.
 *
 * A handshake is only checked once, though, so this alone does not reach a socket that is
 * already open: `recheckAdminSockets` runs it again on a timer, and a password reset
 * disconnects that user's sockets at once.
 *
 * Throws only when the answer could not be found out, i.e. the database is unreachable.
 * The caller decides what that means; neither caller lets the request through.
 */
export async function verifySession(token: string): Promise<Session | null> {
  let payload: string | jwt.JwtPayload
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET!)
  } catch {
    return null
  }

  // A bare-string payload carries no claims, and a signed token with no subject can't
  // identify anyone; rejecting both here keeps them from reaching the database.
  if (typeof payload === "string" || typeof payload.userId !== "string") {
    return null
  }

  const userId = payload.userId

  // Served from Redis where possible — see sessionCache for why, and for why every way
  // that can go wrong ends in the database lookup below rather than in trusting the token.
  let record = await cachedSession(userId)

  if (record === undefined) {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { passwordChangedAt: true, role: true },
    })

    // A deleted account's tokens stay validly signed until they expire.
    if (!user) return null

    record = {
      changedAtSeconds: user.passwordChangedAt
        ? Math.floor(user.passwordChangedAt.getTime() / 1000)
        : null,
      role: user.role,
    }
    rememberSession(userId, record)
  }

  // A valid signature isn't enough on its own: a password reset has to be able to retire
  // the tokens handed out before it. iat is whole seconds, so the reset is truncated the
  // same way — otherwise a token minted moments after a reset looks older than it and
  // gets rejected.
  if (
    record.changedAtSeconds !== null &&
    payload.iat &&
    payload.iat < record.changedAtSeconds
  ) {
    return null
  }

  return { userId, role: record.role }
}
