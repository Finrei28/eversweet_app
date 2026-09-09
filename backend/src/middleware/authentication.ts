import jwt from "jsonwebtoken"
import { Request, Response, NextFunction } from "express"
import { db } from "../lib/db"
import {
  cachedPasswordChangedAt,
  rememberPasswordChangedAt,
} from "../lib/sessionCache"

interface AuthRequest extends Request {
  userId?: string
  role?: string
}

export async function authenticateToken(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers["authorization"]
  const token = authHeader?.split(" ")[1]

  if (!token) {
    res.status(401).json({ message: "Unauthenticated" })
    return
  }

  let payload: jwt.JwtPayload
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET!) as jwt.JwtPayload
  } catch {
    res.status(403).json({ message: "Unauthorised" })
    return
  }

  // A signed token with no subject can't identify anyone; treat it as bad
  // rather than letting it reach the database and surface as a 500.
  if (typeof payload.userId !== "string") {
    res.status(403).json({ message: "Unauthorised" })
    return
  }

  try {
    // A valid signature isn't enough on its own: tokens run for 90 days, so a
    // password reset has to be able to retire the ones handed out before it.
    //
    // Served from Redis where possible. This lookup was the only database work
    // most authenticated requests did before reaching their controller, and a
    // round trip to this app's database costs ~0.9s. A cache miss, a slow Redis
    // and a down Redis all fall into the branch below, so this can only save
    // time — it cannot let a retired token through.
    let changedAtSeconds = await cachedPasswordChangedAt(payload.userId)

    if (changedAtSeconds === undefined) {
      const user = await db.user.findUnique({
        where: { id: payload.userId },
        select: { passwordChangedAt: true },
      })

      if (!user) {
        res.status(403).json({ message: "Unauthorised" })
        return
      }

      rememberPasswordChangedAt(payload.userId, user.passwordChangedAt)

      changedAtSeconds = user.passwordChangedAt
        ? Math.floor(user.passwordChangedAt.getTime() / 1000)
        : null
    }

    // iat is whole seconds, so compare against the reset truncated the same
    // way — otherwise a token minted moments after a reset looks older than it
    // and gets rejected.
    if (changedAtSeconds !== null && payload.iat) {
      if (payload.iat < changedAtSeconds) {
        res.status(403).json({ message: "Unauthorised" })
        return
      }
    }
  } catch {
    res.status(500).json({ message: "Could not verify session" })
    return
  }

  req.userId = payload.userId
  req.role = payload.role
  next()
}
