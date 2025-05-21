import { Request, Response, NextFunction } from "express"

export function authorizeRole(...allowedRoles: string[]) {
  interface AuthRequest extends Request {
    role?: string
  }

  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.role || !allowedRoles.includes(req.role)) {
      res.status(403).json({ message: "Forbidden: Insufficient role" })
      return
    }
    next()
  }
}
