import { getEstimatedPickUpTime } from "@/services/api"
import { StoreHours } from "@/utils/types"
import { toZonedTime, format } from "date-fns-tz"

const NZ_TIMEZONE = "Pacific/Auckland"

export function convertToTime(base: Date, timeStr: string | null): Date | null {
  if (!timeStr) return null
  const [time, modifier] = timeStr.split(" ")
  const [hours, minutes] = time.split(":").map(Number)

  let hrs = hours
  if (modifier === "PM" && hours < 12) hrs += 12
  if (modifier === "AM" && hours === 12) hrs = 0

  const date = new Date(base)
  date.setHours(hrs, minutes, 0, 0)

  return date
}

export function getOpenCloseTime(date: Date | null, storeHours: StoreHours) {
  if (!date) {
    return { openTime: null, closeTime: null, dayName: null }
  }
  const dayName = format(date, "EEEE", {
    timeZone: NZ_TIMEZONE,
  })

  const [openStr, closeStr] = storeHours[dayName] ?? [null, null]
  const openTime = convertToTime(date, openStr)
  const closeTime = convertToTime(date, closeStr)
  return { openTime, closeTime, dayName }
}

export function getNextOpenDay(date: Date, storeHours: StoreHours) {
  const daysOfWeek = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ]
  let nextDate = new Date(date)

  for (let i = 0; i < 7; i++) {
    const dayName = daysOfWeek[nextDate.getDay()]
    const hours = storeHours[dayName]
    if (hours && hours[0] && hours[1]) {
      // Found a day with valid hours
      const [openStr] = hours
      return convertToTime(nextDate, openStr)
    }

    // Move to next day
    nextDate.setDate(nextDate.getDate() + 1)
  }

  // If no days have valid hours, just return null
  return null
}

export async function getNextValidPickupTime(
  selected: Date,
  totalItems: number,
  storeHours: StoreHours,
) {
  const minTime = await getEstimatedPickUpTime(totalItems)

  const date = new Date(selected)

  const { openTime, closeTime } = getOpenCloseTime(date, storeHours)

  if (!openTime || !closeTime) {
    return getNextOpenDay(date, storeHours)
  }

  if (date >= openTime && date <= closeTime) {
    // disable pick up 10 minutes from closing
    //between business hours
    if (date < minTime) return minTime > openTime ? minTime : openTime

    return date
  }

  if (date >= closeTime) {
    // before 12 am
    const tomorrow = new Date(date)

    tomorrow.setDate(tomorrow.getDate() + 1)
    const nextOpenDay = getNextOpenDay(tomorrow, storeHours)
    const nextOpenTime = getOpenCloseTime(nextOpenDay, storeHours).openTime
    return nextOpenTime
  }

  if (date < openTime) {
    // after 12 am
    const nextOpenDay = getNextOpenDay(date, storeHours)
    const nextOpenTime = getOpenCloseTime(nextOpenDay, storeHours).openTime
    if (!nextOpenTime) return minTime
    return nextOpenTime > minTime ? nextOpenTime : minTime
  }
  if (date < minTime) return minTime > openTime ? minTime : openTime

  return openTime
}
