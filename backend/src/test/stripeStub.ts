import { vi, type Mock } from "vitest"

/**
 * Every Stripe call the controllers make, as spies.
 *
 * Tests must never reach Stripe. `setup.ts` only fills in a placeholder key when none is
 * set, and it loads backend/.env first — so on a developer machine an unstubbed client
 * would talk to Stripe with the shop's own secret key. A test file mocks the SDK with
 *
 *   vi.mock("stripe", async (importOriginal) =>
 *     (await import("../test/stripeStub.js")).fakeStripeModule(await importOriginal()),
 *   )
 *
 * `.js` because a runtime `import()` under this tsconfig's NodeNext resolution needs an
 * extension; Vite resolves it to this file.
 *
 * and then reads and programs `stripeApi` through a plain import, the same shape
 * `redisStub` uses.
 */
export const stripeApi = {
  paymentMethods: {
    retrieve: vi.fn(),
    detach: vi.fn(),
    attach: vi.fn(),
    list: vi.fn(),
  },
  paymentIntents: { create: vi.fn(), retrieve: vi.fn() },
  setupIntents: { create: vi.fn(), retrieve: vi.fn() },
  subscriptions: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    retrieve: vi.fn(),
  },
  customers: { retrieve: vi.fn(), create: vi.fn(), update: vi.fn() },
  invoices: { list: vi.fn(), pay: vi.fn(), retrieve: vi.fn() },
  prices: { retrieve: vi.fn() },
  ephemeralKeys: { create: vi.fn() },
  refunds: { create: vi.fn() },
}

/**
 * Clears every spy's calls and programmed results, and nothing else. `vi.resetAllMocks`
 * would also wipe the implementations `redisStub` depends on.
 */
export const resetStripeStub = () => {
  for (const resource of Object.values(stripeApi)) {
    for (const spy of Object.values(resource) as Mock[]) spy.mockReset()
  }
}

/**
 * The module to hand back from `vi.mock("stripe")`. A constructor that returns the stub,
 * so `lib/stripeClient`'s `new Stripe(key)` receives it, with the SDK's real error classes
 * alongside: the controllers tell failures apart with `instanceof`.
 *
 * Webhook signing is the real thing rather than a spy, so a webhook test signs its payload
 * with `Stripe.webhooks.generateTestHeaderString` and the handler's own verification runs.
 */
export const fakeStripeModule = (actual: typeof import("stripe")) => {
  function FakeStripe() {
    return { ...stripeApi, webhooks: actual.Stripe.webhooks }
  }
  FakeStripe.errors = actual.Stripe.errors

  return { ...actual, Stripe: FakeStripe, default: FakeStripe }
}

/** A Stripe "no such object" error, as the SDK throws it. */
export const resourceMissing = (
  actual: typeof import("stripe"),
  message = "No such object",
) =>
  new actual.Stripe.errors.StripeInvalidRequestError({
    type: "invalid_request_error",
    code: "resource_missing",
    message,
  })
