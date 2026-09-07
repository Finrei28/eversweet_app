import { describe } from "vitest"
import jwt from "jsonwebtoken"
import { db } from "../lib/db"

/**
 * Integration tests need a real Postgres: the things they prove — that a
 * unique constraint stops a duplicate, that a failed transaction rolls back —
 * are the database's behaviour, and a mock would only assert that the mock
 * was called.
 *
 * When TEST_DATABASE_URL is absent those suites skip rather than fail, so the
 * unit tests still run for anyone without a database to hand. CI always sets
 * it. `setup.ts` has already copied it over DATABASE_URL by the time this
 * module loads, so `db` is pointed at the test database.
 */
export const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL)

export const describeIfDb = hasTestDatabase ? describe : describe.skip

/**
 * Empties every table. Cheaper and more thorough than unwinding fixtures.
 *
 * Guarded on the database name because the mistake this would cause is
 * unrecoverable: point TEST_DATABASE_URL at a real database by accident and a
 * test run deletes the shop's orders. Name the test database with "test" in
 * it, or this refuses to run.
 */
export const resetDatabase = async () => {
  const url = process.env.TEST_DATABASE_URL ?? ""
  const databaseName = url.split("/").pop()?.split("?")[0] ?? ""

  if (!/test/i.test(databaseName)) {
    throw new Error(
      `Refusing to truncate "${databaseName}": TEST_DATABASE_URL must point at ` +
        `a database whose name contains "test".`,
    )
  }

  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `

  const targets = tables
    .map((t) => t.tablename)
    .filter((name) => name !== "_prisma_migrations")
    .map((name) => `"public"."${name}"`)

  if (targets.length === 0) return

  await db.$executeRawUnsafe(
    `TRUNCATE TABLE ${targets.join(", ")} RESTART IDENTITY CASCADE`,
  )
}

/** A token the real `authenticateToken` middleware will accept. */
export const tokenFor = (userId: string, role = "USER") =>
  jwt.sign({ userId, role }, process.env.JWT_SECRET!, { expiresIn: "1h" })
