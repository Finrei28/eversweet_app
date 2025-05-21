import { useCartStore } from "@/store/cart"
import { storeHours } from "./businessHours"

export function getEstimatedPickUpTime(numOfItems: number) {
  const fiveMinutes = new Date(Date.now() + 5 * 60 * 1000)
  const tenMinutes = new Date(Date.now() + 10 * 60 * 1000)
  const fifteenMinutes = new Date(Date.now() + 15 * 60 * 1000)

  const minTime =
    numOfItems < 3 ? fiveMinutes : numOfItems < 6 ? tenMinutes : fifteenMinutes

  return minTime
}

export function convertToTime(base: Date, timeStr: string): Date {
  const [time, modifier] = timeStr.split(" ")
  const [hours, minutes] = time.split(":").map(Number)

  let hrs = hours
  if (modifier === "PM" && hours < 12) hrs += 12
  if (modifier === "AM" && hours === 12) hrs = 0

  // Adjusting for local time zone
  // const localOffset = base.getTimezoneOffset() * 60000 // offset in milliseconds
  // const localBase = new Date(base.getTime() - localOffset) // Convert to local time zone

  const date = new Date(base)
  date.setHours(hrs)
  date.setMinutes(minutes)
  date.setSeconds(0)
  date.setMilliseconds(0)

  return date
}

export function getOpenCloseTime(date: Date) {
  const dayName = date.toLocaleDateString("en-NZ", { weekday: "long" })
  const [openStr, closeStr] = storeHours[dayName]
  const openTime = convertToTime(date, openStr)
  const closeTime = convertToTime(date, closeStr)
  return { openTime, closeTime, dayName }
}

export function getNextValidPickupTime(selected: Date, totalItems: number) {
  const minTime = getEstimatedPickUpTime(totalItems)
  const now = new Date()
  const date = new Date(selected)
  const { openTime, closeTime } = getOpenCloseTime(date)
  const lastPickup = new Date(closeTime.getTime() - 10 * 60 * 1000) // 10 min before close

  if (date >= openTime && date <= closeTime) {
    if (date < minTime) return minTime > openTime ? minTime : openTime

    return date
  }

  if (date >= closeTime) {
    const tomorrow = new Date()

    tomorrow.setDate(tomorrow.getDate() + 1)
    const openTimeForTomorrow = getOpenCloseTime(tomorrow).openTime
    return openTimeForTomorrow
  }

  if (date < openTime) return openTime > minTime ? openTime : minTime
  if (date < minTime) return minTime > openTime ? minTime : openTime

  return openTime
}
