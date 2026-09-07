import dotenv from "dotenv"

dotenv.config()

/**
 * Several modules read their configuration at import time and assert it is
 * present (`process.env.X!`), so a missing value is a crash on import rather
 * than a failed test with a useful message. Filling in placeholders here keeps
 * unit tests runnable with no environment at all; anything that would actually
 * use one of these is mocked in the test that needs it.
 */
const placeholders: Record<string, string> = {
  JWT_SECRET: "test-jwt-secret",
  STRIPE_SECRET_KEY: "sk_test_placeholder",
  REDIS_URL: "redis://127.0.0.1:6379",
  RESEND_API_KEY: "re_test_placeholder",
  ALLOWED_ORIGINS: "http://localhost",
}

for (const [key, value] of Object.entries(placeholders)) {
  if (!process.env[key]) process.env[key] = value
}

/**
 * Integration tests run against TEST_DATABASE_URL, never DATABASE_URL. Pointed
 * at the same variable the app reads so `lib/db` — a singleton every
 * controller imports — connects to the test database without any injection.
 *
 * Set before any test file imports a controller, which is what `setupFiles`
 * guarantees. Without TEST_DATABASE_URL the integration suites skip and the
 * unit suites still run.
 */
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
  process.env.DIRECT_URL = process.env.TEST_DATABASE_URL
}

process.env.NODE_ENV = "test"
