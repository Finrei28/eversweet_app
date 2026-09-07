import { describe, expect, it, vi } from "vitest"
import jwt from "jsonwebtoken"

import { ADMIN_ROOM, authenticateSocket, handleConnection } from "./socketAuth"

const sign = (payload: object, secret = process.env.JWT_SECRET!) =>
  jwt.sign(payload, secret, { expiresIn: "1h" })

const socketWith = (auth: Record<string, unknown>) =>
  ({ handshake: { auth }, join: vi.fn(), on: vi.fn() }) as any

const authenticate = (auth: Record<string, unknown>) => {
  const socket = socketWith(auth)
  const next = vi.fn()
  authenticateSocket(socket, next)
  return { socket, next, error: next.mock.calls[0]?.[0] as Error | undefined }
}

describe("authenticateSocket", () => {
  it.each([
    ["no token at all", {}],
    ["an empty token", { token: "" }],
    ["a non-string token", { token: 12345 }],
    ["a token that is not a JWT", { token: "not-a-jwt" }],
  ])("rejects %s", (_label, auth) => {
    expect(authenticate(auth).error).toBeInstanceOf(Error)
  })

  it("rejects a token signed with another secret", () => {
    const token = sign({ userId: "user-1", role: "ADMIN" }, "some-other-secret")
    expect(authenticate({ token }).error).toBeInstanceOf(Error)
  })

  it("rejects an expired token", () => {
    const token = jwt.sign({ userId: "user-1" }, process.env.JWT_SECRET!, {
      expiresIn: "-1s",
    })
    expect(authenticate({ token }).error).toBeInstanceOf(Error)
  })

  // A signed token carrying no subject cannot identify anyone.
  it("rejects a valid token with no userId", () => {
    expect(authenticate({ token: sign({ role: "ADMIN" }) }).error).toBeInstanceOf(
      Error,
    )
  })

  it("accepts an admin token and records its role", () => {
    const { socket, error } = authenticate({
      token: sign({ userId: "admin-1", role: "ADMIN" }),
    })

    expect(error).toBeUndefined()
    expect(socket.userId).toBe("admin-1")
    expect(socket.role).toBe("ADMIN")
  })

  // Customers are allowed on the socket; they are simply put in no room.
  it("accepts a customer token without promoting it", () => {
    const { socket, error } = authenticate({
      token: sign({ userId: "user-1", role: "USER" }),
    })

    expect(error).toBeUndefined()
    expect(socket.userId).toBe("user-1")
    expect(socket.role).toBe("USER")
  })
})

describe("handleConnection", () => {
  const connect = (role?: string) => {
    const socket = socketWith({})
    socket.userId = "someone"
    socket.role = role
    handleConnection(socket)
    return socket
  }

  it("puts an admin in the kitchen room", () => {
    expect(connect("ADMIN").join).toHaveBeenCalledWith(ADMIN_ROOM)
  })

  /**
   * The regression this file exists for. Customer tokens are signed with the
   * same secret as admin ones, and the previous middleware labelled every
   * connection "admin" — so any signed-in customer received every order, with
   * the customer's name, email and phone number on it.
   */
  it.each([["USER"], ["STAFF"], [undefined]])(
    "keeps role %s out of the kitchen room",
    (role) => {
      expect(connect(role as string | undefined).join).not.toHaveBeenCalled()
    },
  )
})
