import { db } from "./db"
import { getErrorMessage } from "../utils/getError"

/**
 * The messages the customer app shows in its launch pop-up.
 *
 * The shape is the one `/api/getAnnouncements` has always served: `updatedAt` is what the
 * app compares against the last announcement it displayed (`app/_layout.tsx`), so it must
 * stay something `new Date()` can read. It carries the row's `publishedAt` rather than its
 * `updatedAt`, so correcting a typo does not pop the modal for every customer again.
 *
 * This is on the launch path — the app's first request is what trips the version gate
 * before the splash hides — so it is cached and never throws.
 */
export type Announcement = {
  title: string
  text1: string
  text2?: string
  updatedAt: string
}

/**
 * Unlike the loyalty rates and the shop's details, the fallback here is *empty* rather than
 * the values that used to be hardcoded. Those were placeholder copy ("We are just testing
 * this announcement..."), and showing a customer a stale pop-up is worse than showing none:
 * the app treats an empty list as nothing to announce and carries on.
 */
export const NO_ANNOUNCEMENTS: Announcement[] = []

/** A minute, as for the preparation times and the trading hours. */
const CACHE_TTL_MS = 60_000

let cached: Announcement[] | null = null
let cachedAt = 0

export const getAnnouncements = async (): Promise<Announcement[]> => {
  if (cached && Date.now() - cachedAt < CACHE_TTL_MS) return cached

  try {
    const rows = await db.announcement.findMany({
      where: { isActive: true },
      orderBy: [{ position: "asc" }, { publishedAt: "desc" }],
      select: {
        title: true,
        text1: true,
        text2: true,
        publishedAt: true,
      },
    })

    cached = rows.map((row) => ({
      title: row.title,
      text1: row.text1,
      // Absent rather than null: the field is optional on the wire and installed builds
      // render it only when it is there.
      ...(row.text2 === null ? {} : { text2: row.text2 }),
      updatedAt: row.publishedAt.toISOString(),
    }))
    cachedAt = Date.now()
    return cached
  } catch (error) {
    console.error(
      "Could not read announcements; showing none:",
      getErrorMessage(error),
    )
    // Deliberately not cached: a transient failure should not pin an empty list in place
    // for the next minute.
    return cached ?? NO_ANNOUNCEMENTS
  }
}

/** Called after a write, so the change is visible without waiting out the TTL. */
export const invalidateAnnouncements = () => {
  cached = null
  cachedAt = 0
}
