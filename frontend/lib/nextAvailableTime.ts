import { storeHours } from "./businessHours"

function convertTo24Hour(timeStr) {
  const [time, period] = timeStr.split(" ")
  let [hours, minutes] = time.split(":").map(Number)
  if (period === "PM" && hours !== 12) hours += 12
  if (period === "AM" && hours === 12) hours = 0
  return new Date().setHours(hours, minutes, 0, 0)
}

// Get the current day and time
const currentDay = new Date().toLocaleString("en-us", { weekday: "long" })
const currentTime = new Date()

// Convert store hours to 24-hour time format
const storeOpeningTime = convertTo24Hour(storeHours[currentDay][0])
const storeClosingTime = convertTo24Hour(storeHours[currentDay][1])

// Get 15 minutes from now
const fifteenMinutesFromNow = new Date(currentTime.getTime() + 15 * 60000)

// Logic for determining the next available pickup time
export let pickupTime
if (currentTime.getTime() < storeOpeningTime) {
  // If current time is before opening hours, set pickup time to opening time + 15 minutes
  pickupTime = new Date(storeOpeningTime + 15 * 60000)
} else if (currentTime.getTime() >= storeClosingTime) {
  // If current time is past closing hours, set pickup time to the next opening hour on the next day
  let nextOpeningTime = convertTo24Hour(storeHours[getNextDay(currentDay)][0])
  pickupTime = new Date(nextOpeningTime + 15 * 60000)
} else {
  // Otherwise, ensure the pickup time is within business hours
  pickupTime = fifteenMinutesFromNow

  // Ensure it's not later than 10 minutes before closing
  if (pickupTime >= storeClosingTime - 10 * 60000) {
    pickupTime = new Date(storeClosingTime - 10 * 60000)
  }
}

// Get the next day
function getNextDay(day) {
  const daysOfWeek = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ]
  const currentDayIndex = daysOfWeek.indexOf(day)
  return daysOfWeek[(currentDayIndex + 1) % 7]
}
