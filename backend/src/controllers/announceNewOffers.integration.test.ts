import { beforeEach, describe, expect, it, vi } from "vitest"

// Typed with the real signature, so a test reading `mock.calls[0][2]` is checked rather
// than inferred as an empty tuple.
const { sendOfferNotifications } = vi.hoisted(() => ({
  sendOfferNotifications: vi.fn(
    async (_title: string, _body: string, _isMembersOffer: boolean) =>
      Promise.resolve(1),
  ),
}))

vi.mock("./notification.controller", () => ({ sendOfferNotifications }))

import { db } from "../lib/db"
import { announceNewOffers, claimForAnnouncement } from "../lib/announceOffers"
import { describeIfDb, resetDatabase } from "../test/db"

/**
 * The sweep that tells customers about a new offer.
 *
 * What it has to get right is *which* offers, and *once*. The privacy policy states plainly
 * that we send this notification, so it has to actually go; and it is a broadcast to the
 * whole customer base, so a second one cannot be taken back.
 */
describeIfDb("announceNewOffers", () => {
  const now = new Date("2026-09-20T09:00:00.000Z")
  const day = (offset: number) =>
    new Date(now.getTime() + offset * 24 * 60 * 60 * 1000)

  const makeOffer = (overrides: Record<string, unknown> = {}) =>
    db.offer.create({
      data: {
        name: "Free mochi",
        audience: "EVERYONE",
        isActive: true,
        discountAmount: 20,
        ...overrides,
      },
    })

  beforeEach(async () => {
    await resetDatabase()
    sendOfferNotifications.mockClear()
  })

  it("announces an offer that is live and has not been announced", async () => {
    await makeOffer({ name: "Winter special" })

    await announceNewOffers(now)

    expect(sendOfferNotifications).toHaveBeenCalledTimes(1)
    expect(sendOfferNotifications.mock.calls[0]?.[1]).toContain("Winter special")
  })

  /** The whole reason the column exists. */
  it("does not announce the same offer twice", async () => {
    await makeOffer()

    await announceNewOffers(now)
    await announceNewOffers(new Date(now.getTime() + 60_000))

    expect(sendOfferNotifications).toHaveBeenCalledTimes(1)
  })

  it("stamps the offer so the second sweep can tell", async () => {
    const offer = await makeOffer()

    await announceNewOffers(now)

    const after = await db.offer.findUniqueOrThrow({ where: { id: offer.id } })
    expect(after.notifiedAt).not.toBeNull()
  })

  /**
   * The case that rules out announcing when an offer is written. A scheduled offer is not
   * live yet, so telling customers now would point them at something they cannot see.
   */
  it("leaves a scheduled offer alone until it starts", async () => {
    const offer = await makeOffer({ startsAt: day(3) })

    await announceNewOffers(now)
    expect(sendOfferNotifications).not.toHaveBeenCalled()

    await announceNewOffers(day(4))
    expect(sendOfferNotifications).toHaveBeenCalledTimes(1)

    const after = await db.offer.findUniqueOrThrow({ where: { id: offer.id } })
    expect(after.notifiedAt).not.toBeNull()
  })

  it("leaves a paused offer alone", async () => {
    await makeOffer({ isActive: false })

    await announceNewOffers(now)

    expect(sendOfferNotifications).not.toHaveBeenCalled()
  })

  it("leaves an archived offer alone", async () => {
    await makeOffer({ archivedAt: day(-1) })

    await announceNewOffers(now)

    expect(sendOfferNotifications).not.toHaveBeenCalled()
  })

  it("leaves an offer whose run has ended alone", async () => {
    await makeOffer({ endsAt: day(-1) })

    await announceNewOffers(now)

    expect(sendOfferNotifications).not.toHaveBeenCalled()
  })

  it("sends a members-only offer to members", async () => {
    await makeOffer({ audience: "MEMBERS" })

    await announceNewOffers(now)

    expect(sendOfferNotifications.mock.calls[0]?.[2]).toBe(true)
  })

  /**
   * Deliberately coarse: a NEW_USERS offer goes to everyone rather than to a list of
   * customers who have never ordered, which is not a list to single out.
   */
  it("sends a new-customer offer to everyone", async () => {
    await makeOffer({ audience: "NEW_USERS" })

    await announceNewOffers(now)

    expect(sendOfferNotifications.mock.calls[0]?.[2]).toBe(false)
  })

  /**
   * Cron runs in every instance, so two processes reach the same offer together. The claim
   * is what stops both of them pushing, and it is tested directly: two overlapping sweeps
   * are not a reliable way to produce the interleaving, because each one's claim usually
   * commits before the other's read. Asserting on the claim itself is the guarantee.
   */
  describe("the claim", () => {
    it("succeeds once and then refuses", async () => {
      const offer = await makeOffer()

      await expect(claimForAnnouncement(offer.id, now)).resolves.toBe(true)
      await expect(claimForAnnouncement(offer.id, now)).resolves.toBe(false)
    })

    it("refuses for the loser when two claims are made together", async () => {
      const offer = await makeOffer()

      const results = await Promise.all([
        claimForAnnouncement(offer.id, now),
        claimForAnnouncement(offer.id, now),
      ])

      expect(results.filter(Boolean)).toHaveLength(1)
    })

    it("refuses an offer that was already announced", async () => {
      const offer = await makeOffer({ notifiedAt: day(-1) })

      await expect(claimForAnnouncement(offer.id, now)).resolves.toBe(false)
    })

    /** closeRun clears the stamp, so a second run is announced like the first. */
    it("succeeds again once the stamp is cleared", async () => {
      const offer = await makeOffer()
      await claimForAnnouncement(offer.id, now)

      await db.offer.update({
        where: { id: offer.id },
        data: { notifiedAt: null },
      })

      await expect(claimForAnnouncement(offer.id, now)).resolves.toBe(true)
    })
  })

  it("sends one notification when two sweeps overlap", async () => {
    await makeOffer()

    await Promise.all([announceNewOffers(now), announceNewOffers(now)])

    expect(sendOfferNotifications).toHaveBeenCalledTimes(1)
  })

  it("uses the offer's own description when it has one", async () => {
    await makeOffer({ name: "Mochi Monday", description: "Half price all day" })

    await announceNewOffers(now)

    expect(sendOfferNotifications.mock.calls[0]?.[1]).toBe(
      "Mochi Monday - Half price all day",
    )
  })

  /** A cron has nobody to hand an error to. */
  it("does not throw when the push fails", async () => {
    await makeOffer()
    sendOfferNotifications.mockRejectedValueOnce(new Error("expo is down"))
    vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(announceNewOffers(now)).resolves.toBeUndefined()

    vi.restoreAllMocks()
  })

  it("announces several offers that went live together", async () => {
    await makeOffer({ name: "One" })
    await makeOffer({ name: "Two" })

    await announceNewOffers(now)

    expect(sendOfferNotifications).toHaveBeenCalledTimes(2)
  })
})
