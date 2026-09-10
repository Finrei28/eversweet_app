import { formatInTimeZone, fromZonedTime } from "date-fns-tz"
import { db } from "./db"
import { storeHours } from "./storeInfo"

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

/** The New Zealand weekday name at `date`, e.g. "Monday". */
export const nzDayName = (date: Date) =>
  formatInTimeZone(date, NZ_TIMEZONE, "EEEE")

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

/** Minutes past New Zealand midnight at `date`. */
const nzMinutesOfDay = (date: Date) => {
  const [hours, minutes] = formatInTimeZone(date, NZ_TIMEZONE, "HH:mm")
    .split(":")
    .map(Number)
  return hours * 60 + minutes
}

/**
 * Parses a store-hours string such as "12:30 PM" into minutes past midnight.
 * Returns null for anything unreadable, so a malformed entry reads as "closed"
 * rather than as midnight.
 */
const parseStoreTimeToMinutes = (timeStr: string): number | null => {
  const [time, modifier] = timeStr.trim().split(" ")
  const [hours, minutes] = (time ?? "").split(":").map(Number)

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null

  let hrs = hours % 12
  if (modifier?.toUpperCase() === "PM") hrs += 12

  return hrs * 60 + minutes
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

export type PickUpTimeCheck = { ok: true } | { ok: false; message: string }

/**
 * Whether an order may be placed for `pickUpTime`. The app applies the same
 * rules before letting a customer reach checkout; this is the copy that decides,
 * since a stale build or a direct API call reaches the endpoint regardless.
 */
export const checkPickUpTime = (
  pickUpTime: Date,
  {
    eatIn,
    daysOffKeys,
    now = new Date(),
  }: { eatIn: boolean; daysOffKeys: Set<string>; now?: Date },
): PickUpTimeCheck => {
  if (!(pickUpTime instanceof Date) || Number.isNaN(pickUpTime.getTime())) {
    return { ok: false, message: "That pick up time is not a valid date." }
  }

  const graceMs = PAST_GRACE_MINUTES * 60 * 1000
  if (pickUpTime.getTime() < now.getTime() - graceMs) {
    return { ok: false, message: "That pick up time has already passed." }
  }

  const maxAhead = now.getTime() + MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000
  if (pickUpTime.getTime() > maxAhead) {
    return {
      ok: false,
      message: "Orders can only be placed up to a month in advance.",
    }
  }

  if (daysOffKeys.has(nzCalendarDay(pickUpTime))) {
    return { ok: false, message: "We are closed on that date." }
  }

  const hours = storeHours[nzDayName(pickUpTime)]
  if (!hours) {
    return { ok: false, message: "We are not open on that day." }
  }

  const open = parseStoreTimeToMinutes(hours[0])
  const close = parseStoreTimeToMinutes(hours[1])
  if (open === null || close === null) {
    return { ok: false, message: "We are not open on that day." }
  }

  // The counter stops taking orders before the doors close, and eat-in needs
  // longer because the customer still has to sit and eat.
  const lastOrder =
    close -
    (eatIn ? LAST_ORDER_OFFSET_MINUTES.eatIn : LAST_ORDER_OFFSET_MINUTES.pickup)
  const minutes = nzMinutesOfDay(pickUpTime)

  if (minutes < open || minutes > lastOrder) {
    return { ok: false, message: "We are closed at that time." }
  }

  return { ok: true }
}
