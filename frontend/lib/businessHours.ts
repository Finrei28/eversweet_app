"use client"

import { StoreHours } from "@/utils/types"
import {
  getNZDayName,
  getNZMinutesOfDay,
  parseStoreTimeToMinutes,
} from "./nzTime"

export function isOutsideBusinessHours(date: Date, storeHours: StoreHours) {
  if (!date) {
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
