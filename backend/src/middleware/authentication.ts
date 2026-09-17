import { Request, Response, NextFunction } from "express"

import { verifySession } from "../lib/session"

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

  let session
  try {
    session = await verifySession(token)
  } catch {
    res.status(500).json({ message: "Could not verify session" })
    return
  }

  // A bad signature, an expired token, a deleted account and a token retired by a
  // password reset all land here, and all look the same from outside.
  if (!session) {
    res.status(403).json({ message: "Unauthorised" })
    return
  }

  req.userId = session.userId
  // The role on record, not the one in the token. `authorizeRole` gates every admin
  // route on this, and a token's role is frozen for its whole life — so taking the role
  // from it meant a demoted admin stayed an admin for up to 180 days.
  req.role = session.role
  next()
}
