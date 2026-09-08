import { formatNZ, NZ_TIMEZONE } from "./nzTime"

const Currency_Formatter = new Intl.NumberFormat("en-NZ", {
  style: "currency",
  currency: "NZD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatCurrency(amount: number) {
  return Currency_Formatter.format(amount)
}

const Number_Formatter = new Intl.NumberFormat("en-NZ")

export function formatNumber(amount: number) {
  return Number_Formatter.format(amount)
}

/*
 * Every date the app shows describes something happening at the store —
 * a pickup slot, an order, a renewal — so all of it is rendered in New Zealand
 * time regardless of where the customer's phone thinks it is. Passing a locale
 * alone is not enough: "en-NZ" picks the formatting conventions but still
 * resolves the value against the device's own timezone.
 */

export const formatShortDate = (date: Date) => {
  const newDate = new Date(date)
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: NZ_TIMEZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(newDate)
}

export const formatDate = (dateString: string) => {
  const date = new Date(dateString)
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: NZ_TIMEZONE,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).format(date)
}

export const getCollectionTime = (date: Date) => {
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: NZ_TIMEZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).format(date)
}

/** Time of day, e.g. "2:30 PM". */
export const formatTime = (date: Date) => formatNZ(date, "h:mm a")

/** Day, month and time, e.g. "3/9 2:30 PM". */
export const formatDayMonthTime = (date: Date) => formatNZ(date, "d/M h:mm a")

/** Weekday and date, e.g. "Tuesday 15 September". Names a specific day, for
 * messages where the weekday alone would be ambiguous or misleading. */
export const formatWeekdayDate = (date: Date) => formatNZ(date, "EEEE d MMMM")

/** Date stamp for support messages, e.g. "03/09/2026". */
export const formatDayStamp = (date: Date) => formatNZ(date, "dd/MM/yyyy")

export function roundToNearest5(date: Date) {
  // Epoch arithmetic, so this is timezone independent. It stays aligned to the
  // New Zealand wall clock because Auckland's offset is a whole number of
  // hours; a zone offset by :30 or :45 would land between the 5 minute marks.
  const ms = 1000 * 60 * 5
  return new Date(Math.ceil(date.getTime() / ms) * ms)
}
