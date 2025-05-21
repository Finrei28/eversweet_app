import jwt from "jsonwebtoken"
import { Request, Response, NextFunction } from "express"

interface AuthRequest extends Request {
  userId?: string
  role?: string
}

export function authenticateToken(
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

  jwt.verify(token, process.env.JWT_SECRET!, (err, payload: any) => {
    if (err) {
      res.status(403).json({ message: "Unauthorised" })
      return
    }
    // Optionally type `req.userId` if you add it
    req.userId = payload.userId
    req.role = payload.role
    next()
  })
}
