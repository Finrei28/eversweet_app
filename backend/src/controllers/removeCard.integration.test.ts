import { beforeEach, expect, it, vi } from "vitest"
import request from "supertest"

import { redisStub as redis } from "../test/redisStub"
import app from "../app"
import { db } from "../lib/db"
import { describeIfDb, resetDatabase, tokenFor } from "../test/db"
import { makeUser } from "../test/factories"
import {
  resetStripeStub,
  resourceMissing,
  stripeApi,
} from "../test/stripeStub"

// Reached through a getter because vi.mock is hoisted above the imports.
vi.mock("../lib/redis", () => ({
  get redis() {
    return redis.redis
  },
}))

// Never the real SDK: see test/stripeStub.
vi.mock("stripe", async (importOriginal) =>
  (await import("../test/stripeStub.js")).fakeStripeModule(await importOriginal()),
)

const REMOVE = "/api/stripe/removeCard"
const OWN_CUSTOMER = "cus_own"

const removeCard = (userId: string, paymentMethodId: string) =>
  request(app)
    .delete(REMOVE)
    .set("Authorization", `Bearer ${tokenFor(userId)}`)
    .send({ paymentMethodId })

const customerWithStripe = async () => {
  const user = await makeUser()
  await db.user.update({
    where: { id: user.id },
    data: { stripeCustomerId: OWN_CUSTOMER },
  })
  return user
}

/**
 * removeCard detached whatever id it was sent. A secret-key call can detach any payment
 * method on the account, so any signed-in customer holding another customer's card id
 * could take the card off them — and nothing stopped a member removing the card their
 * membership renews on, which the app only greys out.
 */
describeIfDb("removeCard", () => {
  beforeEach(async () => {
    await resetDatabase()
    redis.clear()
    redis.recover()
    resetStripeStub()
    stripeApi.subscriptions.list.mockResolvedValue({ data: [] })
    stripeApi.paymentMethods.detach.mockResolvedValue({})
  })

  it("will not detach another customer's card", async () => {
    const user = await customerWithStripe()
    stripeApi.paymentMethods.retrieve.mockResolvedValue({
      id: "pm_theirs",
      customer: "cus_someone_else",
    })

    const res = await removeCard(user.id, "pm_theirs")

    expect(res.status).toBe(404)
    expect(stripeApi.paymentMethods.detach).not.toHaveBeenCalled()
  })

  it("answers a card that does not exist exactly as it answers someone else's", async () => {
    const user = await customerWithStripe()
    stripeApi.paymentMethods.retrieve.mockRejectedValue(
      resourceMissing(
        await vi.importActual<typeof import("stripe")>("stripe"),
        "No such PaymentMethod: 'pm_made_up'",
      ),
    )

    const res = await removeCard(user.id, "pm_made_up")

    expect(res.status).toBe(404)
    expect(res.body.message).toBe("Card not found")
    expect(stripeApi.paymentMethods.detach).not.toHaveBeenCalled()
  })

  it("will not detach a card that is attached to nobody", async () => {
    const user = await customerWithStripe()
    stripeApi.paymentMethods.retrieve.mockResolvedValue({
      id: "pm_loose",
      customer: null,
    })

    const res = await removeCard(user.id, "pm_loose")

    expect(res.status).toBe(404)
    expect(stripeApi.paymentMethods.detach).not.toHaveBeenCalled()
  })

  it("refuses a customer with no Stripe record without asking Stripe anything", async () => {
    const user = await makeUser()

    const res = await removeCard(user.id, "pm_anything")

    expect(res.status).toBe(404)
    expect(stripeApi.paymentMethods.retrieve).not.toHaveBeenCalled()
    expect(stripeApi.paymentMethods.detach).not.toHaveBeenCalled()
  })

  /**
   * createMembership sets the customer's invoice default rather than the subscription's
   * own, so this is the shape every membership the app has created is in.
   */
  it("will not detach the card a membership renews on", async () => {
    const user = await customerWithStripe()
    stripeApi.paymentMethods.retrieve.mockResolvedValue({
      id: "pm_membership",
      customer: OWN_CUSTOMER,
    })
    stripeApi.subscriptions.list.mockResolvedValue({
      data: [{ status: "active", default_payment_method: null }],
    })
    stripeApi.customers.retrieve.mockResolvedValue({
      id: OWN_CUSTOMER,
      invoice_settings: { default_payment_method: "pm_membership" },
    })

    const res = await removeCard(user.id, "pm_membership")

    expect(res.status).toBe(409)
    expect(res.body.message).toMatch(/pays for your membership/i)
    expect(stripeApi.paymentMethods.detach).not.toHaveBeenCalled()
  })

  it("detaches a spare card while a membership renews on another", async () => {
    const user = await customerWithStripe()
    stripeApi.paymentMethods.retrieve.mockResolvedValue({
      id: "pm_spare",
      customer: OWN_CUSTOMER,
    })
    stripeApi.subscriptions.list.mockResolvedValue({
      data: [{ status: "active", default_payment_method: "pm_membership" }],
    })

    const res = await removeCard(user.id, "pm_spare")

    expect(res.status).toBe(200)
    expect(stripeApi.paymentMethods.detach).toHaveBeenCalledWith("pm_spare")
  })

  it("detaches a card once the membership behind it has been cancelled", async () => {
    const user = await customerWithStripe()
    stripeApi.paymentMethods.retrieve.mockResolvedValue({
      id: "pm_old_membership",
      customer: OWN_CUSTOMER,
    })
    stripeApi.subscriptions.list.mockResolvedValue({
      data: [{ status: "canceled", default_payment_method: "pm_old_membership" }],
    })

    const res = await removeCard(user.id, "pm_old_membership")

    expect(res.status).toBe(200)
    expect(stripeApi.paymentMethods.detach).toHaveBeenCalledWith(
      "pm_old_membership",
    )
  })
})

const saveCard = (userId: string, paymentMethodId: string) =>
  request(app)
    .post("/api/stripe/saveCard")
    .set("Authorization", `Bearer ${tokenFor(userId)}`)
    .send({ paymentMethodId })

/**
 * saveCard answered someone else's card with "already attached to another customer", which
 * told anyone holding a card id that it was real and in use, and a made-up id with a 500.
 */
describeIfDb("saveCard", () => {
  beforeEach(async () => {
    await resetDatabase()
    redis.clear()
    redis.recover()
    resetStripeStub()
    stripeApi.customers.retrieve.mockResolvedValue({
      id: OWN_CUSTOMER,
      invoice_settings: { default_payment_method: "pm_existing" },
    })
    stripeApi.paymentMethods.attach.mockResolvedValue({})
  })

  it("answers another customer's card exactly as it answers a made-up one", async () => {
    const user = await customerWithStripe()
    stripeApi.paymentMethods.retrieve.mockResolvedValueOnce({
      id: "pm_theirs",
      customer: "cus_someone_else",
    })
    stripeApi.paymentMethods.retrieve.mockRejectedValueOnce(
      resourceMissing(
        await vi.importActual<typeof import("stripe")>("stripe"),
        "No such PaymentMethod: 'pm_made_up'",
      ),
    )

    const theirs = await saveCard(user.id, "pm_theirs")
    const madeUp = await saveCard(user.id, "pm_made_up")

    expect(theirs.status).toBe(404)
    expect(madeUp.status).toBe(404)
    expect(theirs.body).toEqual(madeUp.body)
    expect(stripeApi.paymentMethods.attach).not.toHaveBeenCalled()
  })

  it("saves a card that is not yet on any customer", async () => {
    const user = await customerWithStripe()
    stripeApi.paymentMethods.retrieve.mockResolvedValue({
      id: "pm_new",
      customer: null,
    })

    const res = await saveCard(user.id, "pm_new")

    expect(res.status).toBe(200)
    expect(stripeApi.paymentMethods.attach).toHaveBeenCalledWith("pm_new", {
      customer: OWN_CUSTOMER,
    })
  })

  it("saves a card that is already the customer's own", async () => {
    const user = await customerWithStripe()
    stripeApi.paymentMethods.retrieve.mockResolvedValue({
      id: "pm_mine",
      customer: OWN_CUSTOMER,
    })

    const res = await saveCard(user.id, "pm_mine")

    expect(res.status).toBe(200)
  })
})
