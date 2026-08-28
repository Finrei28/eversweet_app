import {
  format,
  formatInTimeZone,
  fromZonedTime,
  toZonedTime,
} from "date-fns-tz"

/**
 * The store trades in one place, so opening hours are always New Zealand wall
 * clock time. Everything that reads `StoreHours` has to agree on that, which is
 * why day names and time-of-day comparisons all come from this module rather
 * than from the device's own clock and locale.
 */
export const NZ_TIMEZONE = "Pacific/Auckland"

/** The weekday name at `date` as it is in New Zealand, e.g. "Monday". */
export function getNZDayName(date: Date): string {
  return format(date, "EEEE", { timeZone: NZ_TIMEZONE })
}

/** The calendar date at `date` as it is in New Zealand, as "yyyy-MM-dd". */
export function getNZCalendarDay(date: Date): string {
  return format(date, "yyyy-MM-dd", { timeZone: NZ_TIMEZONE })
}

/** How many minutes past New Zealand midnight `date` falls. */
export function getNZMinutesOfDay(date: Date): number {
  const zoned = toZonedTime(date, NZ_TIMEZONE)
  return zoned.getHours() * 60 + zoned.getMinutes()
}

/**
 * Parses a store-hours string such as "12:30 PM" into minutes past midnight.
 * Returns null for anything it cannot read, so a malformed entry reads as
 * "closed" rather than as midnight.
 */
export function parseStoreTimeToMinutes(timeStr: string): number | null {
  const [time, modifier] = timeStr.trim().split(" ")
  const [hours, minutes] = (time ?? "").split(":").map(Number)

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null

  let hrs = hours % 12
  if (modifier?.toUpperCase() === "PM") hrs += 12

  return hrs * 60 + minutes
}

/**
 * The instant at which `timeStr` occurs on whichever New Zealand calendar day
 * `base` falls on. Replaces `date.setHours(...)`, which resolved the time
 * against the device's timezone instead of the store's.
 */
export function nzTimeOnSameDay(
  base: Date,
  timeStr: string | null,
): Date | null {
  if (!timeStr) return null

  const minutes = parseStoreTimeToMinutes(timeStr)
  if (minutes === null) return null

  const hh = String(Math.floor(minutes / 60)).padStart(2, "0")
  const mm = String(minutes % 60).padStart(2, "0")

  return fromZonedTime(
    `${getNZCalendarDay(base)}T${hh}:${mm}:00`,
    NZ_TIMEZONE,
  )
}

/**
 * The New Zealand time of day at `timeSource`, applied to the New Zealand
 * calendar day of `base`. Replaces merging two dates with getHours/setHours,
 * which resolved both against the device's timezone.
 */
export function withNZTimeOfDay(base: Date, timeSource: Date): Date {
  return fromZonedTime(
    `${getNZCalendarDay(base)}T${formatInTimeZone(timeSource, NZ_TIMEZONE, "HH:mm:ss")}`,
    NZ_TIMEZONE,
  )
}

/**
 * `date` shifted by whole days on the New Zealand calendar. The result is
 * midday NZ time on the target day: far enough from midnight that a daylight
 * saving change cannot tip it into the wrong date.
 */
export function addNZDays(date: Date, days: number): Date {
  return shiftNZCalendar(date, { days })
}

/** As `addNZDays`, but shifting whole months on the New Zealand calendar. */
export function addNZMonths(date: Date, months: number): Date {
  return shiftNZCalendar(date, { months })
}

function shiftNZCalendar(
  date: Date,
  { days = 0, months = 0 }: { days?: number; months?: number },
): Date {
  const [year, month, day] = getNZCalendarDay(date).split("-").map(Number)

  // Date.UTC does the calendar arithmetic, including month and year rollover.
  const shifted = new Date(Date.UTC(year, month - 1 + months, day + days))

  return fromZonedTime(
    `${shifted.toISOString().slice(0, 10)}T12:00:00`,
    NZ_TIMEZONE,
  )
}

/** The year and 1-indexed month at `date` as they are in New Zealand. */
export function getNZYearMonth(date: Date): { year: number; month: number } {
  const [year, month] = getNZCalendarDay(date).split("-").map(Number)
  return { year, month }
}

/**
 * Formats `date` using a date-fns pattern, resolved in New Zealand. Exported
 * for lib/formatters, which is where user-facing date strings belong.
 */
export function formatNZ(date: Date, pattern: string): string {
  return formatInTimeZone(date, NZ_TIMEZONE, pattern)
}
