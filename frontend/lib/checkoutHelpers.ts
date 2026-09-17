import { getEstimatedPickUpTime } from "@/services/api"
import {
  isDayOff,
  orderingHoursProblem,
  type OrderingHoursProblem,
  TradingCalendar,
} from "./businessHours"
import { formatDayMonthTime, formatTime, formatWeekdayDate } from "./formatters"
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

const MINUTE_MS = 60 * 1000

/** Rounded up to the whole minute, as every implementation of the rule does. */
export const ceilToMinute = (date: Date) =>
  new Date(Math.ceil(date.getTime() / MINUTE_MS) * MINUTE_MS)

/**
 * The soonest valid time at or after `selected`: now for "as soon as possible", or the
 * time a customer picked. The rule - shared with the website and the order server, and
 * pinned by `pickUpTimeCases.json` - is the later of the kitchen's earliest (rounded up to
 * the whole minute) and opening, if that is no later than the last order; otherwise the
 * next trading day's opening time. Null when nothing opens in the next 60 days.
 */
export async function getNextValidPickupTime(
  selected: Date,
  totalItems: number,
  calendar: TradingCalendar,
  {
    earliestReadyTime,
    lastOrderOffsetMinutes = LAST_ORDER_OFFSET_MINUTES.pickup,
  }: PickupTimeOptions = {},
) {
  const minTime = ceilToMinute(
    earliestReadyTime ?? (await getEstimatedPickUpTime(totalItems)),
  )

  // Compared to the minute, so any second of the last-order minute is still in time.
  const date = new Date(Math.floor(selected.getTime() / MINUTE_MS) * MINUTE_MS)

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

  // Keeps the seconds of a picked time: a time already on the minute is returned as is,
  // so callers comparing it with what was picked see no change.
  return earliest.getTime() === date.getTime() ? new Date(selected) : earliest
}

export type PickUpTimeProblem = OrderingHoursProblem | "too-soon"

/**
 * What to tell a customer whose time cannot stand, and what it became.
 *
 * `movedTo` is the time checkout has already put in its place. When there is one the
 * message has to say so: the day-off and closed-day wording said "please choose another
 * day" while checkout had quietly committed the next valid time, so the customer was told
 * to change something that had already been changed for them.
 */
export function pickUpTimeAlert(
  date: Date | null,
  calendar: TradingCalendar,
  {
    problem = null,
    movedTo = null,
    eatIn,
    lastOrderOffsetMinutes,
  }: {
    problem?: PickUpTimeProblem | null
    movedTo?: Date | null
    eatIn: boolean
    lastOrderOffsetMinutes: number
  },
): { title: string; message: string } {
  const orderKind = eatIn ? "eat-in order" : "pick up"
  const moved = movedTo
    ? ` We've changed it to ${formatDayMonthTime(movedTo)}.`
    : ""

  if (date === null) {
    return {
      title: "Invalid Time",
      message: "Please select a valid pickup time during our business hours.",
    }
  }

  // Named by date, not weekday. A day off is a one-off closure, so "we are open 12:00 PM
  // to 10:00 PM on a Tuesday" would be actively misleading.
  if (isDayOff(date, calendar.daysOff)) {
    return {
      title: "We're closed that day",
      message: `We are closed on ${formatWeekdayDate(date)}.${
        moved || " Please choose another day."
      }`,
    }
  }

  const { openTime, closeTime, dayName } = getOpenCloseTime(date, calendar)

  if (!openTime || !closeTime) {
    return {
      title: "We're closed that day",
      message: `We are not open on ${formatWeekdayDate(date)}.${
        moved || " Please choose another day."
      }`,
    }
  }

  if (problem === "before-open") {
    return {
      title: "Sorry, we're not open yet at that time",
      message: `We open at ${formatTime(openTime)} on a ${dayName}.${moved}`,
    }
  }

  if (problem === "after-last-pick-up") {
    return {
      title: `Sorry, that's after our last ${orderKind}`,
      message: `Our last ${orderKind} on a ${dayName} is ${formatTime(
        getLastOrderTime(closeTime, lastOrderOffsetMinutes),
      )}, so we can close at ${formatTime(closeTime)}.${moved}`,
    }
  }

  // Open, just sooner than the kitchen can have the order ready.
  return {
    title: "That's a little too soon",
    message: movedTo
      ? `The earliest we can have your order ready is ${formatDayMonthTime(movedTo)}, so we've changed it to that.`
      : "Please choose a later time.",
  }
}

/**
 * Why a picked time cannot stand, so the customer is told the actual reason: a time the
 * kitchen cannot make yet is not "closed at that time", which is what every refusal used
 * to say.
 */
export function describePickUpProblem(
  picked: Date,
  calendar: TradingCalendar,
  {
    earliestReadyTime,
    lastOrderOffsetMinutes,
  }: { earliestReadyTime: Date | null; lastOrderOffsetMinutes: number },
): PickUpTimeProblem | null {
  const hoursProblem = orderingHoursProblem(
    picked,
    calendar,
    lastOrderOffsetMinutes,
  )
  if (hoursProblem) return hoursProblem

  return earliestReadyTime &&
    picked.getTime() < ceilToMinute(earliestReadyTime).getTime()
    ? "too-soon"
    : null
}
