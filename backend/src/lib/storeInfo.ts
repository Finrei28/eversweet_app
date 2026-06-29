import { parse, isAfter, isBefore, isEqual } from "date-fns"
import { DateTime } from "luxon"

type StoreHours = {
  [key: string]: [string, string] | null
}

const isStoreOpenNow = (storeHours: StoreHours): boolean => {
  const now = DateTime.now().setZone("Pacific/Auckland")

  const dayName = now.toFormat("cccc").toLowerCase() // Monday, Tuesday...

  const hours = storeHours[dayName]
  if (!hours) return false

  const [startStr, endStr] = hours

  const start = DateTime.fromFormat(startStr, "h:mm a", {
    zone: "Pacific/Auckland",
  })

  const end = DateTime.fromFormat(endStr, "h:mm a", {
    zone: "Pacific/Auckland",
  })

  if (!start.isValid || !end.isValid) return false

  if (end < start) {
    return now >= start || now <= end
  }

  return now >= start && now <= end
}

export const storeHours: StoreHours = {
  monday: ["12:30 PM", "9:30 PM"],
  tuesday: ["12:30 PM", "9:30 PM"],
  wednesday: ["12:30 PM", "9:30 PM"],
  thursday: ["12:30 PM", "9:30 PM"],
  friday: ["12:00 PM", "10:00 PM"],
  saturday: ["12:00 PM", "10:00 PM"],
  sunday: ["12:00 PM", "10:00 PM"],
}

export const storeInfo = {
  name: "Eversweet",
  isOpen: isStoreOpenNow(storeHours),
  address: "5D/119 Meadowland Drive, Somerville",
  city: "Auckland",
  state: "Auckland",
  postal: "2014",
  phone: "09 949 1050",
  email: "eversweet@eversweet.co.nz",
  website: "https://eversweet.co.nz",
}

// export const storeHours = {
//   Monday: [null],
//   Tuesday: [null],
//   Wednesday: null,
//   Thursday: [null],
//   Friday: [null],
//   Saturday: [null],
//   Sunday: [null],
// }
