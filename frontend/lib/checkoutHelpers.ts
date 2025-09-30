import { StoreHours } from "./businessHours"

export function getEstimatedPickUpTime(numOfItems: number) {
  const fiveMinutes = new Date(Date.now() + 6 * 60 * 1000)
  const tenMinutes = new Date(Date.now() + 11 * 60 * 1000)
  const fifteenMinutes = new Date(Date.now() + 16 * 60 * 1000)

  const minTime =
    numOfItems < 3 ? fiveMinutes : numOfItems < 6 ? tenMinutes : fifteenMinutes

  return minTime
}

export function convertToTime(base: Date, timeStr: string): Date {
  if (!timeStr) return null
  const [time, modifier] = timeStr.split(" ")
  const [hours, minutes] = time.split(":").map(Number)

  let hrs = hours
  if (modifier === "PM" && hours < 12) hrs += 12
  if (modifier === "AM" && hours === 12) hrs = 0

  // Adjusting for local time zone
  // const localOffset = base.getTimezoneOffset() * 60000 // offset in milliseconds
  // const localBase = new Date(base.getTime() - localOffset) // Convert to local time zone

  const date = new Date(base)
  date.setHours(hrs, minutes, 0, 0)

  return date
}

export function getOpenCloseTime(date: Date, storeHours: StoreHours) {
  if (!date) {
    return { openTime: null, closeTime: null, dayName: null }
  }
  const dayName = date.toLocaleDateString("en-NZ", { weekday: "long" })

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

export function getNextValidPickupTime(
  selected: Date,
  totalItems: number,
  storeHours: StoreHours
) {
  const minTime = getEstimatedPickUpTime(totalItems)

  const date = new Date(selected)
  const { openTime, closeTime } = getOpenCloseTime(date, storeHours)

  if (!openTime || !closeTime) {
    return getNextOpenDay(date, storeHours)
  }

  if (date >= openTime && date <= closeTime) {
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
    return nextOpenTime > minTime ? nextOpenTime : minTime
  }
  if (date < minTime) return minTime > openTime ? minTime : openTime

  return openTime
}
