import cases from "./pickUpTimeCases.json"
import {
  fetchTradingCalendar,
  isOpenNow,
  isOutsideOrderingHours,
  orderingHoursProblem,
  type TradingCalendar,
} from "./businessHours"
import {
  ceilToMinute,
  describePickUpProblem,
  getNextValidPickupTime,
  LAST_ORDER_OFFSET_MINUTES,
  pickUpTimeAlert,
} from "./checkoutHelpers"
import { getNZCalendarDay, getNZDayName, getNZMinutesOfDay } from "./nzTime"

// Every call below passes the kitchen's estimate in, so nothing reaches the network.
jest.mock("@/services/api", () => ({
  getEstimatedPickUpTime: jest.fn(() => {
    throw new Error("a test reached the network for an estimate")
  }),
}))

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
]

/** Minutes past midnight as the server serves them, e.g. 750 is "12:30 PM". */
const storeTime = (minutes: number) => {
  const hours24 = Math.floor(minutes / 60)
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12
  return `${hours12}:${String(minutes % 60).padStart(2, "0")} ${
    hours24 >= 12 ? "PM" : "AM"
  }`
}

/**
 * A case's hours in the shape `/api/getStoreHours` serves them, which is what the app
 * holds - so these run the same path a real calendar does, string parsing included.
 */
const calendarFor = (
  hours: (number[] | null)[] | undefined,
  daysOff: string[],
): TradingCalendar => ({
  storeHours: Object.fromEntries(
    (hours ?? cases.hours).map((day, weekday) => [
      DAY_NAMES[weekday],
      day ? [storeTime(day[0]), storeTime(day[1])] : null,
    ]),
  ),
  daysOff: new Set(daysOff),
})

const SHOP = calendarFor(undefined, [])
const PICKUP = LAST_ORDER_OFFSET_MINUTES.pickup
const EAT_IN = LAST_ORDER_OFFSET_MINUTES.eatIn

/** Thursday 5 March 2026 in Auckland: 12:30 PM to 9:30 PM. */
const thu = (time: string) => new Date(`2026-03-05T${time}:00+13:00`)

/**
 * The device timezone this run was started in, when it was started in one on purpose.
 * Jest fixes the zone when its workers start - setting `process.env.TZ` inside a test file
 * changes nothing, as a version of this file that tried it found - so the device-timezone
 * runs are separate invocations:
 *
 *   TZ=UTC npx jest lib
 *   TZ=America/Los_Angeles npx jest lib
 *   TZ=Asia/Kolkata npx jest lib
 */
const EXPECTED_OFFSET: Record<string, number> = {
  UTC: 0,
  "America/Los_Angeles": 480,
  "Asia/Kolkata": -330,
}

/**
 * The rule every implementation agrees on - the website's `src/lib/pickUpTimes.ts`, the
 * order server's `lib/tradingHours.ts` and this - as cases, copied byte-for-byte between
 * the repos. A phone can be set to any timezone, and every answer here has to come from
 * the Auckland clock.
 */
describe(`the shared pick-up time cases, with the device in ${
  process.env.TZ ?? "this machine's timezone"
}`, () => {
  const timezone = process.env.TZ
  if (timezone && timezone in EXPECTED_OFFSET) {
    // Proves the zone took, so a pass is not just the machine's own zone again.
    it("is really running in that timezone", () => {
      expect(new Date("2026-03-02T00:00:00Z").getTimezoneOffset()).toBe(
        EXPECTED_OFFSET[timezone],
      )
    })
  }

  it.each(cases.asap)("ASAP: $name", async (c) => {
    const now = new Date(c.now)
    const asap = await getNextValidPickupTime(
      now,
      2,
      calendarFor(c.hours as (number[] | null)[] | undefined, c.daysOff),
      {
        // What `/api/getEstimatedPickUpTime` answers: now plus the quote.
        earliestReadyTime: new Date(now.getTime() + c.quoteMinutes * 60_000),
        lastOrderOffsetMinutes: PICKUP,
      },
    )

    expect(asap?.toISOString() ?? null).toBe(
      c.expected ? new Date(c.expected).toISOString() : null,
    )
  })

  it.each(cases.validity)("validity: $name", (c) => {
    expect(
      orderingHoursProblem(
        new Date(c.at),
        calendarFor(c.hours as (number[] | null)[] | undefined, c.daysOff),
        PICKUP,
      ),
    ).toBe(c.reason)
  })
})

describe("isOutsideOrderingHours", () => {
  /**
   * The checkout guard used to stop at closing time, so 9:21-9:30 PM on a 9:30 day got
   * through to the order server, which refused it after the customer pressed pay.
   */
  it("stops at the last pick-up, not at closing", () => {
    expect(isOutsideOrderingHours(thu("21:20"), SHOP, PICKUP)).toBe(false)
    expect(isOutsideOrderingHours(thu("21:21"), SHOP, PICKUP)).toBe(true)
    expect(isOutsideOrderingHours(thu("21:29"), SHOP, PICKUP)).toBe(true)
  })

  it("stops eat-in half an hour before closing", () => {
    expect(isOutsideOrderingHours(thu("21:00"), SHOP, EAT_IN)).toBe(false)
    expect(isOutsideOrderingHours(thu("21:01"), SHOP, EAT_IN)).toBe(true)
  })

  it("treats a missing time as outside", () => {
    expect(isOutsideOrderingHours(null, SHOP, PICKUP)).toBe(true)
  })
})

describe("getNextValidPickupTime", () => {
  const next = (picked: Date, now: Date, offset: number = PICKUP) =>
    getNextValidPickupTime(picked, 2, SHOP, {
      earliestReadyTime: new Date(now.getTime() + 10 * 60_000),
      lastOrderOffsetMinutes: offset,
    })

  it("keeps a picked time that is already valid, exactly", async () => {
    const picked = thu("19:00")
    expect((await next(picked, thu("18:00")))?.getTime()).toBe(picked.getTime())
  })

  it("moves a picked time the kitchen cannot make to the soonest it can", async () => {
    expect(await next(thu("18:05"), thu("18:00"))).toEqual(thu("18:10"))
  })

  it("moves a picked time after the last order to the next opening", async () => {
    expect(await next(thu("21:25"), thu("18:00"))).toEqual(
      new Date("2026-03-06T12:00:00+13:00"),
    )
  })

  it("closes eat-in earlier than pick-up for the same time", async () => {
    expect(await next(thu("21:10"), thu("18:00"), PICKUP)).toEqual(thu("21:10"))
    expect(await next(thu("21:10"), thu("18:00"), EAT_IN)).toEqual(
      new Date("2026-03-06T12:00:00+13:00"),
    )
  })

  it("rounds the kitchen's estimate up to the whole minute", () => {
    expect(ceilToMinute(new Date("2026-03-05T18:10:01+13:00"))).toEqual(
      thu("18:11"),
    )
    expect(ceilToMinute(thu("18:10"))).toEqual(thu("18:10"))
  })
})

describe("describePickUpProblem", () => {
  const describeAt = (picked: Date, offset: number = PICKUP) =>
    describePickUpProblem(picked, SHOP, {
      earliestReadyTime: new Date(thu("18:00").getTime() + 10 * 60_000),
      lastOrderOffsetMinutes: offset,
    })

  // Every refusal used to say "we are closed at that time", even this one.
  it("tells a time the kitchen cannot make yet apart from a closed one", () => {
    expect(describeAt(thu("18:05"))).toBe("too-soon")
    expect(describeAt(thu("18:10"))).toBeNull()
  })

  it("names the hours problem when there is one", () => {
    expect(describeAt(thu("12:00"))).toBe("before-open")
    expect(describeAt(thu("21:25"))).toBe("after-last-pick-up")
    expect(describeAt(thu("21:10"), EAT_IN)).toBe("after-last-pick-up")
  })
})

describe("pickUpTimeAlert", () => {
  const alertFor = (
    date: Date | null,
    calendar: TradingCalendar,
    over: Partial<Parameters<typeof pickUpTimeAlert>[2]> = {},
  ) =>
    pickUpTimeAlert(date, calendar, {
      eatIn: false,
      lastOrderOffsetMinutes: PICKUP,
      ...over,
    })

  const fridayNoon = new Date("2026-03-06T12:00:00+13:00")
  const closedThursday = calendarFor(undefined, ["2026-03-05"])
  const closedThursdays = calendarFor(
    cases.hours.map((day, weekday) => (weekday === 4 ? null : day)),
    [],
  )

  /**
   * Checkout commits the next valid time when a picked day is shut. These said "please
   * choose another day" regardless, so the customer was told to change a time that had
   * already been changed for them - and never told what it now was.
   */
  it.each([
    ["a day off", closedThursday, "We are closed on Thursday 5 March."],
    ["a closed weekday", closedThursdays, "We are not open on Thursday 5 March."],
  ])(
    "names the replacement time for %s",
    (_, calendar, closedSentence) => {
      const { title, message } = alertFor(thu("14:00"), calendar, {
        problem: "closed-day",
        movedTo: fridayNoon,
      })

      expect(title).toBe("We're closed that day")
      expect(message).toBe(`${closedSentence} We've changed it to 6/3 12:00 PM.`)
      expect(message).not.toContain("choose another day")
    },
  )

  it.each([
    ["a day off", closedThursday],
    ["a closed weekday", closedThursdays],
  ])(
    "asks for another day on %s only when nothing was changed",
    (_, calendar) => {
      expect(alertFor(thu("14:00"), calendar).message).toContain(
        "Please choose another day.",
      )
    },
  )

  it("names the last pick-up and the new time after the cut-off", () => {
    expect(
      alertFor(thu("21:25"), SHOP, {
        problem: "after-last-pick-up",
        movedTo: fridayNoon,
      }),
    ).toEqual({
      title: "Sorry, that's after our last pick up",
      message:
        "Our last pick up on a Thursday is 9:20 PM, so we can close at 9:30 PM. We've changed it to 6/3 12:00 PM.",
    })
  })

  it("names the last eat-in order for an eat-in order", () => {
    expect(
      alertFor(thu("21:10"), SHOP, {
        problem: "after-last-pick-up",
        eatIn: true,
        lastOrderOffsetMinutes: EAT_IN,
      }).message,
    ).toContain("Our last eat-in order on a Thursday is 9:00 PM")
  })

  it("says a time is too soon rather than closed", () => {
    expect(
      alertFor(thu("18:05"), SHOP, { problem: "too-soon", movedTo: thu("18:10") }),
    ).toEqual({
      title: "That's a little too soon",
      message:
        "The earliest we can have your order ready is 5/3 6:10 PM, so we've changed it to that.",
    })
  })
})

describe("fetchTradingCalendar", () => {
  const hours = SHOP.storeHours
  const ok = <T,>(value: T) => () => Promise.resolve(value)
  const fail = () => Promise.reject(new Error("offline"))

  beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => undefined)
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it("is ready with both, days off keyed by Auckland calendar day", async () => {
    const loaded = await fetchTradingCalendar({
      getStoreHours: ok(hours),
      getDaysOff: ok([new Date("2026-03-06T00:00:00+13:00")]),
    })

    expect(loaded).toEqual({
      status: "ready",
      storeHours: hours,
      daysOff: new Set(["2026-03-06"]),
    })
  })

  /**
   * Days off that failed used to become an empty list while the hours still read as ready,
   * so "Open Now" said open on a day the shop had closed, for the rest of the session.
   */
  it.each([
    ["the days off", ok(hours), fail],
    ["the hours", fail, ok([] as Date[])],
    ["both", fail, fail],
  ])("is an error when %s fail to load", async (_, getStoreHours, getDaysOff) => {
    expect(
      await fetchTradingCalendar({
        getStoreHours: getStoreHours as () => Promise<typeof hours>,
        getDaysOff: getDaysOff as () => Promise<Date[]>,
      }),
    ).toEqual({ status: "error" })
  })
})

describe("isOpenNow", () => {
  it("is open from opening up to closing, not only to the last order", () => {
    expect(isOpenNow(thu("12:29"), SHOP)).toBe(false)
    expect(isOpenNow(thu("12:30"), SHOP)).toBe(true)
    expect(isOpenNow(thu("21:25"), SHOP)).toBe(true)
    expect(isOpenNow(thu("21:30"), SHOP)).toBe(false)
  })

  it("is closed on a day off", () => {
    expect(isOpenNow(thu("18:00"), calendarFor(undefined, ["2026-03-05"]))).toBe(
      false,
    )
  })
})

describe("getNZMinutesOfDay", () => {
  /**
   * `toZonedTime` and `formatInTimeZone` both build a Date whose device-local fields spell
   * the Auckland time. On a phone in Los Angeles, 2:30 AM on 8 March 2026 does not exist -
   * the clocks jump from 2:00 to 3:00 - so the Auckland time 2:30 AM that day read as 3:30.
   * Only bites in the `TZ=America/Los_Angeles` run; passes trivially elsewhere.
   */
  it("reads an Auckland time that falls in the device's daylight saving gap", () => {
    const aucklandHalfTwo = new Date("2026-03-08T02:30:00+13:00")
    expect(getNZMinutesOfDay(aucklandHalfTwo)).toBe(150)
    expect(getNZCalendarDay(aucklandHalfTwo)).toBe("2026-03-08")
    expect(getNZDayName(aucklandHalfTwo)).toBe("Sunday")
  })

  it("reads midnight as the start of the day, not 24:00", () => {
    expect(getNZMinutesOfDay(new Date("2026-03-09T00:05:00+13:00"))).toBe(5)
  })
})
