export const storeHours = {
  Monday: ["12:30 PM", "9:30 PM"],
  Tuesday: ["12:30 PM", "9:30 PM"],
  Wednesday: null,
  Thursday: ["12:30 PM", "9:30 PM"],
  Friday: ["12:00 PM", "10:00 PM"],
  Saturday: ["12:00 PM", "10:00 PM"],
  Sunday: ["12:00 PM", "10:00 PM"],
}

export function isOutsideBusinessHours(date: Date) {
  const dayName = date.toLocaleDateString("en-NZ", { weekday: "long" }) // e.g., "Monday"
  const [openStr, closeStr] = storeHours[dayName]

  const [openHour, openMinute, openPeriod] = parseTime(openStr)
  const [closeHour, closeMinute, closePeriod] = parseTime(closeStr)

  const current = date.getHours() * 60 + date.getMinutes()
  const open = to24HourMinutes(openHour, openMinute, openPeriod)
  const close = to24HourMinutes(closeHour, closeMinute, closePeriod)

  return current < open || current > close
}

function parseTime(timeStr) {
  const [time, period] = timeStr.split(" ")
  const [hour, minute] = time.split(":").map(Number)
  return [hour, minute, period]
}

function to24HourMinutes(hour, minute, period) {
  let h = hour % 12
  if (period === "PM") h += 12
  return h * 60 + minute
}
