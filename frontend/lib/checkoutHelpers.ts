import { getEstimatedPickUpTime } from "@/services/api"
import { isDayOff, TradingCalendar } from "./businessHours"
import { addNZDays, getNZDayName, nzTimeOnSameDay } from "./nzTime"

/**
 * How far ahead `getNextOpenDay` will look for a trading day. A run of days off
 * can close the store for longer than a week, so this reaches past the seven
 * days the weekly hours alone would need.
 */
const MAX_DAYS_AHEAD = 60

export function getOpenCloseTime(
  date: Date | null,
  { storeHours, daysOff }: TradingCalendar,
) {
  if (!date) {
    return { openTime: null, closeTime: null, dayName: null }
  }
  const dayName = getNZDayName(date)

  // A day off overrides the weekly hours, so the day reads as shut and every
  // caller that asks for its opening or closing time gets nothing back.
  const [openStr, closeStr] = isDayOff(date, daysOff)
    ? [null, null]
    : (storeHours[dayName] ?? [null, null])
  const openTime = nzTimeOnSameDay(date, openStr)
  const closeTime = nzTimeOnSameDay(date, closeStr)
  return { openTime, closeTime, dayName }
}

export function getNextOpenDay(date: Date, calendar: TradingCalendar) {
  const { storeHours, daysOff } = calendar

  for (let i = 0; i < MAX_DAYS_AHEAD; i++) {
    // Step through New Zealand calendar days rather than the device's, so a
    // phone set to another timezone doesn't skip or repeat a trading day.
    const candidate = addNZDays(date, i)

    if (isDayOff(candidate, daysOff)) continue

    const hours = storeHours[getNZDayName(candidate)]

    if (hours && hours[0] && hours[1]) {
      // Found a day with valid hours
      return nzTimeOnSameDay(candidate, hours[0])
    }
  }

  // If no days have valid hours, just return null
  return null
}

/**
 * How long before closing the counter stops accepting each kind of order.
 * Eat-in needs longer because the customer still has to sit and eat.
 */
export const LAST_ORDER_OFFSET_MINUTES = {
  pickup: 10,
  eatIn: 30,
} as const

export type PickupTimeOptions = {
  /**
   * The earliest the kitchen can have the order ready. Callers that already
   * hold this value pass it in; without it this function fetches its own copy,
   * which meant a caller needing both made the same request twice.
   */
  earliestReadyTime?: Date
  /** Defaults to the pickup cut-off; pass the eat-in one for dine-in orders. */
  lastOrderOffsetMinutes?: number
}

/** The latest an order of this type can be booked on `date`'s trading day. */
export function getLastOrderTime(
  closeTime: Date,
  lastOrderOffsetMinutes: number,
) {
  return new Date(closeTime.getTime() - lastOrderOffsetMinutes * 60 * 1000)
}

export async function getNextValidPickupTime(
  selected: Date,
  totalItems: number,
  calendar: TradingCalendar,
  {
    earliestReadyTime,
    lastOrderOffsetMinutes = LAST_ORDER_OFFSET_MINUTES.pickup,
  }: PickupTimeOptions = {},
) {
  const minTime = earliestReadyTime ?? (await getEstimatedPickUpTime(totalItems))

  const date = new Date(selected)

  const nextOpeningFrom = (from: Date) => {
    const nextOpenDay = getNextOpenDay(from, calendar)
    return getOpenCloseTime(nextOpenDay, calendar).openTime
  }

  const { openTime, closeTime } = getOpenCloseTime(date, calendar)

  // Covers a day off too: `getOpenCloseTime` reports one as having no hours,
  // so the search moves on to the next day the store is actually trading.
  if (!openTime || !closeTime) {
    return getNextOpenDay(date, calendar)
  }

  // The counter stops taking orders before the doors close. This rule was
  // described in a comment here but never applied — closeTime itself was the
  // bound, so an order could be booked for the closing minute.
  const lastOrderTime = getLastOrderTime(closeTime, lastOrderOffsetMinutes)

  // Past today's cut-off, so the soonest slot is on the next trading day.
  if (date > lastOrderTime) {
    return nextOpeningFrom(addNZDays(date, 1))
  }

  // A slot cannot be before opening, and cannot be before the kitchen can have
  // the order ready.
  const earliest = new Date(
    Math.max(date.getTime(), minTime.getTime(), openTime.getTime()),
  )

  // The kitchen being backed up can push the earliest slot past the cut-off,
  // which leaves nothing bookable today.
  if (earliest > lastOrderTime) {
    return nextOpeningFrom(addNZDays(date, 1))
  }

  return earliest
}
