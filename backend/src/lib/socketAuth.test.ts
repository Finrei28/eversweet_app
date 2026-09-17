import { beforeEach, describe, expect, it, vi } from "vitest"
import jwt from "jsonwebtoken"

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }))

// The session check reads the user row; the cache always misses here, so every
// test goes through that read and decides what it says.
vi.mock("./db", () => ({ db: { user: { findUnique } } }))
vi.mock("./sessionCache", () => ({
  cachedSession: vi.fn(async () => undefined),
  rememberSession: vi.fn(),
}))

import { ADMIN_ROOM, authenticateSocket, handleConnection } from "./socketAuth"

const sign = (payload: object, secret = process.env.JWT_SECRET!) =>
  jwt.sign(payload, secret, { expiresIn: "1h" })

const socketWith = (auth: Record<string, unknown>) =>
  ({ handshake: { auth }, join: vi.fn(), on: vi.fn() }) as any

const authenticate = async (auth: Record<string, unknown>) => {
  const socket = socketWith(auth)
  const next = vi.fn()
  await authenticateSocket(socket, next)
  return { socket, next, error: next.mock.calls[0]?.[0] as Error | undefined }
}

/** The row on record for whoever the token names. */
const onRecord = (row: { role: string; passwordChangedAt?: Date | null } | null) =>
  findUnique.mockResolvedValue(
    row && { passwordChangedAt: row.passwordChangedAt ?? null, role: row.role },
  )

describe("authenticateSocket", () => {
  beforeEach(() => {
    findUnique.mockReset()
    onRecord({ role: "USER" })
  })

  it.each([
    ["no token at all", {}],
    ["an empty token", { token: "" }],
    ["a non-string token", { token: 12345 }],
    ["a token that is not a JWT", { token: "not-a-jwt" }],
  ])("rejects %s", async (_label, auth) => {
    expect((await authenticate(auth)).error).toBeInstanceOf(Error)
  })

  it("rejects a token signed with another secret", async () => {
    const token = sign({ userId: "user-1", role: "ADMIN" }, "some-other-secret")
    expect((await authenticate({ token })).error).toBeInstanceOf(Error)
  })

  it("rejects an expired token", async () => {
    const token = jwt.sign({ userId: "user-1" }, process.env.JWT_SECRET!, {
      expiresIn: "-1s",
    })
    expect((await authenticate({ token })).error).toBeInstanceOf(Error)
  })

  // A signed token carrying no subject cannot identify anyone.
  it("rejects a valid token with no userId", async () => {
    const { error } = await authenticate({ token: sign({ role: "ADMIN" }) })
    expect(error).toBeInstanceOf(Error)
    expect(findUnique).not.toHaveBeenCalled()
  })

  it("accepts an admin and records the role on record", async () => {
    onRecord({ role: "ADMIN" })

    const { socket, error } = await authenticate({
      token: sign({ userId: "admin-1", role: "ADMIN" }),
    })

    expect(error).toBeUndefined()
    expect(socket.userId).toBe("admin-1")
    expect(socket.role).toBe("ADMIN")
  })

  // Customers are allowed on the socket; they are simply put in no room.
  it("accepts a customer token without promoting it", async () => {
    const { socket, error } = await authenticate({
      token: sign({ userId: "user-1", role: "USER" }),
    })

    expect(error).toBeUndefined()
    expect(socket.userId).toBe("user-1")
    expect(socket.role).toBe("USER")
  })

  /**
   * The role in a token is fixed for its 180 day life. Read from there, an admin who
   * had been demoted still joined the kitchen room and received every order.
   */
  it("takes the role from the record, not from the token", async () => {
    onRecord({ role: "USER" })

    const { socket, error } = await authenticate({
      token: sign({ userId: "demoted-1", role: "ADMIN" }),
    })

    expect(error).toBeUndefined()
    expect(socket.role).toBe("USER")
  })

  /**
   * The HTTP middleware retired these; the socket did not, so a reset shut a thief out
   * of the API while their socket kept receiving orders.
   */
  it("rejects a token issued before the password was last changed", async () => {
    const token = sign({ userId: "admin-1", role: "ADMIN" })
    onRecord({ role: "ADMIN", passwordChangedAt: new Date(Date.now() + 60_000) })

    expect((await authenticate({ token })).error).toBeInstanceOf(Error)
  })

  it("rejects a token for an account that no longer exists", async () => {
    onRecord(null)

    const { error } = await authenticate({
      token: sign({ userId: "gone-1", role: "ADMIN" }),
    })

    expect(error).toBeInstanceOf(Error)
  })

  it("fails closed when the session cannot be checked", async () => {
    findUnique.mockRejectedValue(new Error("Can't reach database server"))

    const { socket, error } = await authenticate({
      token: sign({ userId: "admin-1", role: "ADMIN" }),
    })

    expect(error).toBeInstanceOf(Error)
    expect(socket.role).toBeUndefined()
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
