import { Prisma } from "@prisma/client"

/**
 * "Is this offer switched on, not archived, and inside its dates?"
 *
 * Mirrors `isWithinActiveWindow` and `isOfferRunning` in the website repo
 * (`src/lib/activeWindow.ts`, `src/lib/offers.ts`), which is where offers are authored
 * and where the admin's status badge comes from. Drift between the two means the badge
 * says LIVE on an offer this server refuses, or ENDED on one it is still serving — and
 * the shop only finds out from a customer.
 *
 * `startsAt`/`endsAt`/`archivedAt` arrived with the 2026-09-12 migration and nothing here
 * read them, so a run scheduled for next month was served today and one that ended last
 * week was still being served.
 */

/** The fields this needs: any query supplying an offer to these must select all four. */
export type OfferWindow = {
  isActive: boolean
  startsAt: Date | null
  endsAt: Date | null
  archivedAt: Date | null
}

/**
 * Both bounds are **inclusive**, matching the website: an offer is live at the instant it
 * starts and at the instant it ends. A null bound means "no bound" — which is how every
 * offer written before those columns existed reads, and why they needed no backfill.
 */
export const isOfferLive = (
  offer: OfferWindow,
  now: Date = new Date(),
): boolean =>
  offer.isActive &&
  offer.archivedAt === null &&
  (offer.startsAt === null || offer.startsAt <= now) &&
  (offer.endsAt === null || offer.endsAt >= now)

/**
 * The same question as a Prisma `where` fragment, for the queries that list offers rather
 * than check one.
 *
 * Written out rather than derived from `isOfferLive` because Postgres cannot run a
 * TypeScript predicate. The two are kept in step by hand, and `offerAvailability.test.ts`
 * runs one table of cases through both so they cannot answer differently.
 *
 * Both bounds live under a single `AND`: two top-level `OR` keys in one object would
 * collide, and the second would silently win.
 */
export const liveOfferWhere = (now: Date = new Date()): Prisma.OfferWhereInput => ({
  isActive: true,
  archivedAt: null,
  AND: [
    { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
    { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
  ],
})
