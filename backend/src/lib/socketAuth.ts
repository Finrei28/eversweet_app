import type { Server, Socket } from "socket.io"

import { ADMIN_ROOM, getIo } from "./socket"
import { verifySession } from "./session"
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

/**
 * Who is on the socket, and as what.
 *
 * The first version passed a callback to `jwt.verify` but read the result
 * outside it, then assigned `socket.userId = "admin"` to every connection
 * regardless of what the token said. Customer tokens are signed with the same
 * `JWT_SECRET`, so any signed-in customer could join the kitchen room and
 * receive every order — names, emails and phone numbers included.
 *
 * The second took the role from the token and checked only its signature. That
 * kept customers out, but a token retired by a password reset still connected,
 * and a demoted admin's token still said ADMIN. Both now go through the same
 * `verifySession` as every HTTP request, so the room is joined on the role on
 * record. Non-admin tokens are still allowed to connect: nothing else subscribes
 * today, but refusing them outright would break any client that later dials in
 * for its own events, and a socket in no room receives nothing regardless.
 */
export const authenticateSocket = async (
  socket: Socket,
  next: (err?: Error) => void,
) => {
  const token = socket.handshake.auth?.token

  if (typeof token !== "string" || !token) {
    return next(new Error("Authentication error"))
  }

  let session
  try {
    session = await verifySession(token)
  } catch (error) {
    // Fails closed. The app reconnects on its own, and a socket let in unchecked
    // could be let into the kitchen room.
    console.error("Could not verify a socket session:", getErrorMessage(error))
    return next(new Error("Authentication error"))
  }

  if (!session) {
    return next(new Error("Authentication error"))
  }

  socket.userId = session.userId
  socket.role = session.role
  // Also on `data`, which is the part of a socket `fetchSockets()` hands back — the
  // re-checks below find sockets that way.
  socket.data = { userId: session.userId, role: session.role }

  next()
}

/**
 * Sends away every kitchen socket whose session no longer holds: a password reset since it
 * connected, an account demoted or deleted, a token that has run out.
 *
 * The handshake is checked once, and a kitchen tablet can stay connected for days. So the
 * rules every HTTP request is held to — the ones that stopped a demoted admin or a retired
 * token at the door — did nothing about a socket already inside, which went on receiving
 * every order with its customer's name, email and phone number. Run on a timer.
 *
 * A check that cannot be made — the database unreachable — keeps the socket. It passed a
 * full check when it connected, and dropping every tablet in the shop over a database blip
 * would silence the order alarms mid-service.
 */
export const recheckAdminSockets = async (io: Server) => {
  try {
    const sockets = await io.in(ADMIN_ROOM).fetchSockets()

    await Promise.all(
      sockets.map(async (socket) => {
        const token = socket.handshake.auth?.token

        let session
        try {
          session =
            typeof token === "string" && token
              ? await verifySession(token)
              : null
        } catch (error) {
          console.error(
            `Could not re-check kitchen socket ${socket.id}:`,
            getErrorMessage(error),
          )
          return
        }

        if (session?.role !== "ADMIN") socket.disconnect(true)
      }),
    )
  } catch (error) {
    console.error("Could not re-check kitchen sockets:", getErrorMessage(error))
  }
}

/**
 * Disconnects one user's sockets straight away. For a password reset, which should not
 * have to wait for the next re-check to shut out whoever held the old password.
 */
export const disconnectUserSockets = async (userId: string) => {
  const io = getIo()
  if (!io) return

  try {
    const sockets = await io.fetchSockets()
    for (const socket of sockets) {
      if (socket.data?.userId === userId) socket.disconnect(true)
    }
  } catch (error) {
    console.error(
      `Could not disconnect the sockets of user ${userId}:`,
      getErrorMessage(error),
    )
  }
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
