import jwt from "jsonwebtoken"
import type { Server, Socket } from "socket.io"

import { ADMIN_ROOM } from "./socket"
import { getErrorMessage } from "../utils/getError"

declare module "socket.io" {
  interface Socket {
    userId?: string
    role?: string
  }
}

// Defined alongside the emitters that publish to it, so the room a socket is
// let into and the room an order is sent to cannot drift apart.
export { ADMIN_ROOM }

const verify = (token: string): jwt.JwtPayload | null => {
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!)
    // A token whose payload is a bare string carries no claims to authorise on.
    return typeof payload === "string" ? null : payload
  } catch {
    return null
  }
}

/**
 * Who is on the socket, and as what.
 *
 * The previous version passed a callback to `jwt.verify` but read the result
 * outside it, then assigned `socket.userId = "admin"` to every connection
 * regardless of what the token said. Customer tokens are signed with the same
 * `JWT_SECRET`, so any signed-in customer could join the kitchen room and
 * receive every order — names, emails and phone numbers included.
 *
 * The role now comes from the token, and the room is joined on the strength of
 * it. Non-admin tokens are still allowed to connect: nothing else subscribes
 * today, but refusing them outright would break any client that later dials in
 * for its own events, and a socket in no room receives nothing regardless.
 */
export const authenticateSocket = (
  socket: Socket,
  next: (err?: Error) => void,
) => {
  const token = socket.handshake.auth?.token

  if (typeof token !== "string" || !token) {
    return next(new Error("Authentication error"))
  }

  const payload = verify(token)

  if (!payload || typeof payload.userId !== "string") {
    return next(new Error("Authentication error"))
  }

  socket.userId = payload.userId
  socket.role = typeof payload.role === "string" ? payload.role : undefined

  next()
}

export const handleConnection = (socket: Socket) => {
  if (socket.role === "ADMIN") {
    socket.join(ADMIN_ROOM)
  }

  socket.on("error", (error) => {
    console.error(
      `Socket error for ${socket.userId ?? "unknown"}:`,
      getErrorMessage(error),
    )
  })
}

export const registerSocketHandlers = (io: Server) => {
  io.use(authenticateSocket)
  io.on("connection", handleConnection)
  return io
}
