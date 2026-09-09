import { PrismaClient } from "@prisma/client"
import { recordQuery } from "../middleware/requestTiming"

const createPrismaClient = () => {
  const client = new PrismaClient({
    // `query` is emitted as an event rather than printed so every query can be
    // attributed to the request that caused it — see requestTiming. In
    // development it is still echoed below.
    log: [
      { emit: "event", level: "query" },
      { emit: "stdout", level: "error" },
      { emit: "stdout", level: "warn" },
    ],
  })

  client.$on("query", (event) => {
    recordQuery(event.duration)

    if (process.env.NODE_ENV === "development") {
      console.log(`prisma ${event.duration}ms ${event.query}`)
    }
  })

  return client
}

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined
}

export const db = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db
