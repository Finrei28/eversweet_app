import { beforeEach, describe, expect, it } from "vitest"

import { db } from "./db"
import { isOfferLive, liveOfferWhere, OfferWindow } from "./offerAvailability"
import { describeIfDb, resetDatabase } from "../test/db"

const at = (iso: string) => new Date(iso)
const NOW = at("2026-09-12T12:00:00.000Z")

/**
 * One table, run through both the predicate and the Prisma fragment below, because the
 * two are separate implementations of the same question - Postgres cannot run the
 * TypeScript one - and nothing but these tests stops them drifting apart.
 */
const CASES: { name: string; window: OfferWindow; live: boolean }[] = [
  {
    name: "open-ended and switched on",
    window: { isActive: true, startsAt: null, endsAt: null, archivedAt: null },
    live: true,
  },
  {
    name: "switched off",
    window: { isActive: false, startsAt: null, endsAt: null, archivedAt: null },
    live: false,
  },
  {
    name: "archived",
    window: {
      isActive: true,
      startsAt: null,
      endsAt: null,
      archivedAt: at("2026-09-01T00:00:00.000Z"),
    },
    live: false,
  },
  {
    name: "inside its window",
    window: {
      isActive: true,
      startsAt: at("2026-09-01T00:00:00.000Z"),
      endsAt: at("2026-09-30T00:00:00.000Z"),
      archivedAt: null,
    },
    live: true,
  },
  {
    name: "scheduled for next month",
    window: {
      isActive: true,
      startsAt: at("2026-10-01T00:00:00.000Z"),
      endsAt: null,
      archivedAt: null,
    },
    live: false,
  },
  {
    name: "ended last week",
    window: {
      isActive: true,
      startsAt: null,
      endsAt: at("2026-09-05T00:00:00.000Z"),
      archivedAt: null,
    },
    live: false,
  },
  // Both bounds are inclusive, matching isWithinActiveWindow in the website repo. An
  // offer that ran "until the 12th" must still run at the instant named, or the admin's
  // LIVE badge and this server disagree for as long as that instant lasts.
  {
    name: "exactly at its start",
    window: { isActive: true, startsAt: NOW, endsAt: null, archivedAt: null },
    live: true,
  },
  {
    name: "exactly at its end",
    window: { isActive: true, startsAt: null, endsAt: NOW, archivedAt: null },
    live: true,
  },
  {
    name: "one millisecond past its end",
    window: {
      isActive: true,
      startsAt: null,
      endsAt: new Date(NOW.getTime() - 1),
      archivedAt: null,
    },
    live: false,
  },
  {
    name: "archived but still inside its window",
    window: {
      isActive: true,
      startsAt: at("2026-09-01T00:00:00.000Z"),
      endsAt: at("2026-09-30T00:00:00.000Z"),
      archivedAt: at("2026-09-10T00:00:00.000Z"),
    },
    live: false,
  },
]

describe("isOfferLive", () => {
  it.each(CASES)("$name -> $live", ({ window, live }) => {
    expect(isOfferLive(window, NOW)).toBe(live)
  })
})

describeIfDb("liveOfferWhere", () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  // The fragment is what the three list endpoints actually run. Asserting it against the
  // same table is the only thing that keeps it honest.
  it("selects exactly the offers isOfferLive calls live", async () => {
    await db.offer.createMany({
      data: CASES.map((testCase) => ({
        name: testCase.name,
        audience: "EVERYONE" as const,
        ...testCase.window,
      })),
    })

    const selected = await db.offer.findMany({
      where: liveOfferWhere(NOW),
      select: { name: true },
    })

    expect(selected.map((offer) => offer.name).sort()).toEqual(
      CASES.filter((testCase) => testCase.live)
        .map((testCase) => testCase.name)
        .sort(),
    )
  })
})
