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

/** Whether `date` falls on a day the store has closed outright. */
export function isDayOff(date: Date, daysOff: DaysOff): boolean {
  return daysOff.has(getNZCalendarDay(date))
}

export function isOutsideBusinessHours(
  date: Date,
  { storeHours, daysOff }: TradingCalendar,
) {
  if (!date) {
    return true
  }

  // A day off closes the store whatever the weekly hours say for that weekday.
  if (isDayOff(date, daysOff)) {
    return true
  }

  // Day name and time of day both have to come from the store's timezone.
  // Reading them off the device clock disagreed with checkoutHelpers, which
  // already resolved the day name in New Zealand.
  const hours = storeHours[getNZDayName(date)]
  if (!hours) {
    return true
  }

  const [openStr, closeStr] = hours
  const open = parseStoreTimeToMinutes(openStr)
  const close = parseStoreTimeToMinutes(closeStr)

  if (open === null || close === null) {
    return true
  }

  const current = getNZMinutesOfDay(date)

  return current < open || current > close
}
