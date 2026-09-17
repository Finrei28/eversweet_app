"use client"

import { StoreHours } from "@/utils/types"
import {
  getNZCalendarDay,
  getNZDayName,
  getNZMinutesOfDay,
  parseStoreTimeToMinutes,
} from "./nzTime"

/**
 * Re-keys store hours to the capitalised weekday names `getNZDayName` produces.
 *
 * The API serves them lower case ("monday"), so every exact-key lookup missed,
 * all seven days read as closed, and `getNextValidPickupTime` returned null —
 * which the checkout screen shows as "we are currently closed". Normalising as
 * the hours enter the app keeps one casing everywhere, including the day labels
 * on the store-info screen. Insertion order is preserved, so that list still
 * runs Monday to Sunday.
 */
export function normaliseStoreHours(storeHours: StoreHours): StoreHours {
  return Object.fromEntries(
    Object.entries(storeHours).map(([day, hours]) => [
      day.charAt(0).toUpperCase() + day.slice(1).toLowerCase(),
      hours,
    ]),
  )
}

/**
 * Dates the store is shut regardless of its weekly hours, held as New Zealand
 * calendar days ("yyyy-MM-dd"). A Set because every use is a membership test.
 */
export type DaysOff = ReadonlySet<string>

/**
 * The weekly hours together with the one-off closures layered over them. The
 * two always travel together — a day can be within the weekly hours and still
 * be shut — so they are passed as one value rather than as two arguments a
 * caller could half-remember.
 */
export type TradingCalendar = {
  storeHours: StoreHours
  daysOff: DaysOff
}

/**
 * Turns the raw days-off dates from the API into calendar-day keys.
 *
 * The admin app stores each one as midnight on the day the owner picked, so the
 * stored instant only names the intended day once read back in New Zealand.
 * Comparing the instants directly would match nothing, since a pickup time is
 * never exactly midnight.
 */
export function toDaysOff(dates: Date[]): DaysOff {
  return new Set(dates.map(getNZCalendarDay))
}

export type LoadedTradingCalendar =
  | ({ status: "ready" } & TradingCalendar)
  | { status: "error" }

/**
 * Fetches the weekly hours and the days off together, and reports them as ready only when
 * both arrived. Either one missing is an error, for the caller to offer a retry.
 *
 * Days off that failed to load used to become an empty list while the hours still read as
 * ready. "Open Now" then showed the shop open on a day it had closed, checkout offered
 * times on that day, and nothing ever tried again for the rest of the session - the same
 * guess-instead-of-fail the hours' hard-coded fallback made.
 */
export async function fetchTradingCalendar({
  getStoreHours,
  getDaysOff,
}: {
  getStoreHours: () => Promise<StoreHours>
  getDaysOff: () => Promise<Date[]>
}): Promise<LoadedTradingCalendar> {
  const [storeHours, daysOff] = await Promise.all([
    getStoreHours().catch((error) => {
      console.error("Failed to fetch store hours:", error)
      return null
    }),
    getDaysOff().catch((error) => {
      console.error("Failed to fetch days off:", error)
      return null
    }),
  ])

  return storeHours && daysOff
    ? { status: "ready", storeHours, daysOff: toDaysOff(daysOff) }
    : { status: "error" }
}

/** Whether `date` falls on a day the store has closed outright. */
export function isDayOff(date: Date, daysOff: DaysOff): boolean {
  return daysOff.has(getNZCalendarDay(date))
}

/**
 * Why a time is outside the hours the shop takes orders for, matching the order server's
 * reasons and the shared `pickUpTimeCases.json`.
 */
export type OrderingHoursProblem =
  | "closed-day"
  | "before-open"
  | "after-last-pick-up"

/** A day's opening and closing in minutes past Auckland midnight, or null when shut. */
export function nzDayMinutes(
  date: Date,
  { storeHours, daysOff }: TradingCalendar,
): { open: number; close: number } | null {
  // A day off closes the store whatever the weekly hours say for that weekday.
  if (isDayOff(date, daysOff)) return null

  // Day name and time of day both come from the store's timezone, never the device's.
  const hours = storeHours[getNZDayName(date)]
  if (!hours) return null

  const open = parseStoreTimeToMinutes(hours[0])
  const close = parseStoreTimeToMinutes(hours[1])
  return open === null || close === null ? null : { open, close }
}

/**
 * What is wrong with `date` as an order time on the shop's hours, or null when nothing is.
 * Bounded by the last order, not by closing: a pick-up is taken up to 10 minutes before
 * close and eat-in up to 30, so a late customer still leaves the shop time to shut on
 * time. Compared to the minute, as the order server does.
 */
export function orderingHoursProblem(
  date: Date,
  calendar: TradingCalendar,
  lastOrderOffsetMinutes: number,
): OrderingHoursProblem | null {
  const day = nzDayMinutes(date, calendar)
  if (!day) return "closed-day"

  const current = getNZMinutesOfDay(date)
  if (current < day.open) return "before-open"
  if (current > day.close - lastOrderOffsetMinutes) return "after-last-pick-up"
  return null
}

/**
 * Whether an order cannot be placed for `date`. This checked against closing time rather
 * than the last order, so checkout let 9:21-9:30 PM through on a 9:30 day and left the
 * order server to refuse it after the customer had pressed pay.
 */
export function isOutsideOrderingHours(
  date: Date | null,
  calendar: TradingCalendar,
  lastOrderOffsetMinutes: number,
) {
  return !date || orderingHoursProblem(date, calendar, lastOrderOffsetMinutes) !== null
}

/**
 * Whether the doors are open at `now`, from opening up to closing. "Open Now" on the store
 * screen: this runs to closing, not to the last order. Worked out on the device, where the
 * order server's `isOpen` was fixed when the server started.
 */
export function isOpenNow(now: Date, calendar: TradingCalendar) {
  const day = nzDayMinutes(now, calendar)
  if (!day) return false
  const current = getNZMinutesOfDay(now)
  return current >= day.open && current < day.close
}
