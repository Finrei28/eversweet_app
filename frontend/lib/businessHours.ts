"use client"

import { StoreHours } from "@/utils/types"

export function isOutsideBusinessHours(date: Date, storeHours: StoreHours) {
  if (!date) {
    return true
  }
  const dayName = date.toLocaleDateString("en-NZ", { weekday: "long" }) // e.g., "Monday"
  if (!storeHours[dayName]) {
    return true
  }
  const [openStr, closeStr] = storeHours[dayName]

  const [openHour, openMinute, openPeriod] = parseTime(openStr)
  const [closeHour, closeMinute, closePeriod] = parseTime(closeStr)

  const current = date.getHours() * 60 + date.getMinutes()
  const open = to24HourMinutes(openHour, openMinute, openPeriod)
  const close = to24HourMinutes(closeHour, closeMinute, closePeriod)

  return current < open || current > close
}

function parseTime(timeStr: string): [number, number, string] {
  const [time, period] = timeStr.split(" ")
  const [hour, minute] = time.split(":").map(Number)
  return [hour, minute, period]
}

function to24HourMinutes(hour: number, minute: number, period: string) {
  let h = hour % 12
  if (period === "PM") h += 12
  return h * 60 + minute
}
