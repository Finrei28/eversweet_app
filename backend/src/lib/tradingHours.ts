import { formatInTimeZone, fromZonedTime } from "date-fns-tz"
import { db } from "./db"

export const NZ_TIMEZONE = "Pacific/Auckland"

/**
 * How long before closing the counter stops accepting each kind of order.
 * Mirrors LAST_ORDER_OFFSET_MINUTES in the app's lib/checkoutHelpers.ts — the
 * two must agree, or the app offers slots this rejects.
 */
export const LAST_ORDER_OFFSET_MINUTES = {
  pickup: 10,
  eatIn: 30,
} as const

/**
 * A booking may be placed at most this far ahead. Matches the one-month window
 * the app's date picker allows, and stops a client asking for a slot years out.
 */
const MAX_DAYS_AHEAD = 40

/**
 * Latitude for the gap between the app working a time out and this request
 * arriving: clock skew, a slow network, a customer who took a moment to
 * confirm. Without it a legitimate "as soon as possible" order placed on the
 * minute boundary would be refused.
 */
const PAST_GRACE_MINUTES = 20

/** The New Zealand calendar day at `date`, as "yyyy-MM-dd". */
export const nzCalendarDay = (date: Date) =>
  formatInTimeZone(date, NZ_TIMEZONE, "yyyy-MM-dd")

/**
 * The New Zealand calendar month containing `date` — as a half-open range of
 * instants, plus the 1-indexed month number and year naming it.
 *
 * The loyalty leaderboard is monthly on the New Zealand calendar and its winner
 * cron fires at NZ midnight on the 1st, but the API runs on Render in UTC. Every
 * month boundary in that feature used to be worked out with `new Date(y, m, 1)`,
 * which is server-local: on a UTC host the boundary landed 12-13 hours early, so
 * the cron firing at NZ midnight on 1 September computed *July's* window, tried
 * to insert a July row that already existed, and had the resulting P2002
 * swallowed. After its first successful run it never recorded a winner again.
 *
 * `offset` steps whole months — -1 is the month that just ended. It is applied
 * as integer arithmetic on the month number rather than by mutating a Date with
 * `setMonth`, which overflows: asking a 31 March date for the previous month
 * produced "31 February", which normalises forward into March.
 *
 * Both bounds go through `fromZonedTime`, so the daylight saving switch in late
 * September and early April is the zone's problem rather than arithmetic's.
 */
export const nzMonthRange = (date: Date, offset = 0) => {
  const year = Number(formatInTimeZone(date, NZ_TIMEZONE, "yyyy"))
  const monthIndex = Number(formatInTimeZone(date, NZ_TIMEZONE, "MM")) - 1

  // Normalised through a single count of months since year 0, so an offset that
  // crosses New Year wraps the year with it and no month ever lands outside 1-12.
  const absolute = year * 12 + monthIndex + offset
  const targetYear = Math.floor(absolute / 12)
  const targetMonth = absolute - targetYear * 12 + 1

  return {
    start: nzMonthStart(targetYear, targetMonth),
    end: nzMonthStart(targetYear, targetMonth + 1),
    month: targetMonth,
    year: targetYear,
  }
}

/** NZ midnight on the 1st, taking a 13th month to mean January of the next year. */
const nzMonthStart = (year: number, month: number) => {
  const rolledYear = month > 12 ? year + 1 : year
  const rolledMonth = month > 12 ? month - 12 : month

  return fromZonedTime(
    `${rolledYear}-${String(rolledMonth).padStart(2, "0")}-01T00:00:00`,
    NZ_TIMEZONE,
  )
}

/**
 * The shop's weekly hours, one entry per weekday (0 = Sunday), in minutes past Auckland
 * midnight. A null day is closed.
 *
 * Read from the `TradingHours` table, which the website's repo owns. The hours were
 * hard-coded here as "12:30 PM" strings, one of five copies - the website's checkout, its
 * home page, the app's fallback and a commented holiday copy were the others - that had to
 * be kept in step by hand.
 */
export type DayHours = { opensAt: number; closesAt: number }
export type WeeklyHours = readonly (DayHours | null)[]
export type TradingHoursRow = {
  weekday: number
  opensAt: number | null
  closesAt: number | null
}

/** The table's rows as `WeeklyHours`. A weekday with no row reads as closed. */
export const toWeeklyHours = (rows: readonly TradingHoursRow[]): WeeklyHours =>
  Array.from({ length: 7 }, (_, weekday) => {
    const row = rows.find((r) => r.weekday === weekday)
    return row && row.opensAt !== null && row.closesAt !== null
      ? { opensAt: row.opensAt, closesAt: row.closesAt }
      : null
  })

/** A minute, as for the preparation times. */
const HOURS_CACHE_TTL_MS = 60_000

let cachedHours: WeeklyHours | null = null
let cachedHoursAt = 0

/**
 * The weekly hours, cached for a minute. There is no fallback: hours that cannot be read
 * leave nothing to check a time against, so the request fails rather than guessing - a
 * guessed copy is how the five copies came to exist.
 */
export const getTradingHours = async (): Promise<WeeklyHours> => {
  if (cachedHours && Date.now() - cachedHoursAt < HOURS_CACHE_TTL_MS) {
    return cachedHours
  }

  const rows = await db.tradingHours.findMany({
    select: { weekday: true, opensAt: true, closesAt: true },
  })
  if (rows.length !== 7) {
    console.error(
      `TradingHours holds ${rows.length} row(s), not 7: the missing weekdays read as closed.`,
    )
  }

  cachedHours = toWeeklyHours(rows)
  cachedHoursAt = Date.now()
  return cachedHours
}

/** Clears the cache, so a change to the hours is seen at once. */
export const invalidateTradingHours = () => {
  cachedHours = null
  cachedHoursAt = 0
}

/** Minutes past Auckland midnight at `date`, ignoring seconds. */
export const nzMinutesOfDay = (date: Date) => {
  const [hours, minutes] = formatInTimeZone(date, NZ_TIMEZONE, "HH:mm")
    .split(":")
    .map(Number)
  return hours * 60 + minutes
}

/** The Auckland weekday at `date`, 0 = Sunday. ISO numbers Sunday 7. */
export const nzWeekday = (date: Date) =>
  Number(formatInTimeZone(date, NZ_TIMEZONE, "i")) % 7

/** Minutes past midnight as the store-hours strings the app reads, e.g. 750 is "12:30 PM". */
export const formatStoreTime = (minutes: number) => {
  const hours24 = Math.floor(minutes / 60)
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12
  const suffix = hours24 >= 12 && hours24 < 24 ? "PM" : "AM"
  return `${hours12}:${String(minutes % 60).padStart(2, "0")} ${suffix}`
}

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
]

/**
 * The hours in the shape `/api/getStoreHours` has always served - day name to
 * ["12:30 PM", "9:30 PM"], or null when closed - Monday first. App builds already
 * installed read exactly this, and list the days in the order they arrive.
 */
export const storeHoursByDayName = (
  hours: WeeklyHours,
): Record<string, [string, string] | null> =>
  Object.fromEntries(
    [1, 2, 3, 4, 5, 6, 0].map((weekday) => {
      const day = hours[weekday]
      return [
        DAY_NAMES[weekday],
        day ? [formatStoreTime(day.opensAt), formatStoreTime(day.closesAt)] : null,
      ]
    }),
  )

/**
 * Whether the doors are open at `now`: from opening up to closing, on a day that is not a
 * day off. This is "Open Now" on the store screen, so it runs to closing rather than to
 * the last pick-up.
 *
 * It used to be worked out once, when the server started, and served unchanged until the
 * next restart - and it never looked at days off.
 */
export const isOpenAt = (
  now: Date,
  hours: WeeklyHours,
  daysOffKeys: ReadonlySet<string>,
) => {
  if (daysOffKeys.has(nzCalendarDay(now))) return false
  const day = hours[nzWeekday(now)]
  if (!day) return false
  const minutes = nzMinutesOfDay(now)
  return minutes >= day.opensAt && minutes < day.closesAt
}

/**
 * The days the store is closed outright, as New Zealand calendar days.
 *
 * The admin app stores each as midnight on the chosen day, so the instant only
 * names the intended day once read back in New Zealand.
 */
export const getDaysOffKeys = async (): Promise<Set<string>> => {
  const daysOff = await db.daysOff.findMany({ select: { date: true } })
  return new Set(daysOff.map((day) => nzCalendarDay(day.date)))
}

/**
 * Why a time was refused. The hours reasons - closed-day, before-open,
 * after-last-pick-up - are the ones `pickUpTimeCases.json` holds every implementation to;
 * the others are this endpoint's own limits.
 */
export type PickUpTimeProblem =
  | "invalid-date"
  | "past"
  | "too-far-ahead"
  | "closed-day"
  | "before-open"
  | "after-last-pick-up"

export type PickUpTimeCheck =
  | { ok: true }
  | { ok: false; reason: PickUpTimeProblem; message: string }

/**
 * Whether an order may be placed for `pickUpTime`. The app applies the same
 * rules before letting a customer reach checkout; this is the copy that decides,
 * since a stale build or a direct API call reaches the endpoint regardless.
 *
 * The last pick-up is 10 minutes before closing and the last eat-in order 30, compared to
 * the minute on the Auckland clock: any second of 9:20 PM still makes a 9:30 close.
 */
export const checkPickUpTime = (
  pickUpTime: Date,
  {
    eatIn,
    daysOffKeys,
    hours,
    now = new Date(),
  }: {
    eatIn: boolean
    daysOffKeys: ReadonlySet<string>
    hours: WeeklyHours
    now?: Date
  },
): PickUpTimeCheck => {
  const refuse = (reason: PickUpTimeProblem, message: string) =>
    ({ ok: false, reason, message }) as const

  if (!(pickUpTime instanceof Date) || Number.isNaN(pickUpTime.getTime())) {
    return refuse("invalid-date", "That pick up time is not a valid date.")
  }

  const graceMs = PAST_GRACE_MINUTES * 60 * 1000
  if (pickUpTime.getTime() < now.getTime() - graceMs) {
    return refuse("past", "That pick up time has already passed.")
  }

  const maxAhead = now.getTime() + MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000
  if (pickUpTime.getTime() > maxAhead) {
    return refuse(
      "too-far-ahead",
      "Orders can only be placed up to a month in advance.",
    )
  }

  if (daysOffKeys.has(nzCalendarDay(pickUpTime))) {
    return refuse("closed-day", "We are closed on that date.")
  }

  const day = hours[nzWeekday(pickUpTime)]
  if (!day) {
    return refuse("closed-day", "We are not open on that day.")
  }

  const minutes = nzMinutesOfDay(pickUpTime)
  if (minutes < day.opensAt) {
    return refuse(
      "before-open",
      `We open at ${formatStoreTime(day.opensAt)} that day.`,
    )
  }

  // The counter stops taking orders before the doors close, so a late customer still
  // leaves the shop time to close on time; eat-in needs longer, to sit and eat.
  const lastOrder =
    day.closesAt -
    (eatIn ? LAST_ORDER_OFFSET_MINUTES.eatIn : LAST_ORDER_OFFSET_MINUTES.pickup)
  if (minutes > lastOrder) {
    return refuse(
      "after-last-pick-up",
      eatIn
        ? `Our last eat-in order that day is ${formatStoreTime(lastOrder)}.`
        : `Our last pick up that day is ${formatStoreTime(lastOrder)}.`,
    )
  }

  return { ok: true }
}
