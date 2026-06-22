import { parse, isAfter, isBefore } from "date-fns"

type StoreHours = {
  [key: string]: [string, string] | null
}

const isStoreOpenNow = (storeHours: StoreHours): boolean => {
  const now = new Date()
  const dayName = now.toLocaleDateString("en-NZ", { weekday: "long" })
  const hours = storeHours[dayName as keyof typeof storeHours]

  if (!hours) {
    return false
  }

  const [startStr, endStr] = hours

  const start = parse(startStr, "hh:mm a", now)
  const end = parse(endStr, "hh:mm a", now)

  return isAfter(now, start) && isBefore(now, end)
}

export const storeHours: StoreHours = {
  Monday: ["12:30 PM", "9:30 PM"],
  Tuesday: ["12:30 PM", "9:30 PM"],
  Wednesday: ["12:30 PM", "9:30 PM"],
  Thursday: ["12:30 PM", "9:30 PM"],
  Friday: ["12:00 PM", "10:00 PM"],
  Saturday: ["12:00 PM", "10:00 PM"],
  Sunday: ["12:00 PM", "10:00 PM"],
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
