import { Order } from "@/lib/types"

import {
  BOLD_ON,
  buildReceipt,
  COLUMNS,
  CUT_PAPER,
  formatStamp,
  formatTimeOfDay,
  row,
  SIZE_TITLE,
  wrap,
} from "./receipt"

const NOW = new Date("2026-03-02T14:20:00+13:00")

type Customisation = { name: string; quantity: number; priceInCents?: number }

const makeItem = (
  name: string,
  quantity: number,
  priceInCents: number,
  customisations: Customisation[] = [],
) => ({
  id: `${name}-line`,
  quantity,
  priceInCents,
  discountedAmountInCents: 0,
  customisations: customisations.map((c, index) => ({
    id: `${name}-cust-${index}`,
    quantity: c.quantity,
    discountedAmountInCents: 0,
    customisation: { name: c.name, priceInCents: c.priceInCents ?? 0 },
  })),
  dessert: { name },
})

const makeOrder = (over: Record<string, unknown> = {}): Order =>
  ({
    tempOrderId: "6015",
    customerFirstName: "Jordan",
    customerLastName: "Blake",
    priceInCents: 2400,
    discountedAmountInCents: 0,
    GST: 313,
    dineIn: false,
    createdAt: NOW,
    pickUpTime: new Date(NOW.getTime() + 25 * 60_000),
    desserts: [makeItem("Mango Sago", 2, 1200)],
    ...over,
  }) as unknown as Order

/** The receipt as the paper shows it: control codes gone, one line per line. */
const printed = (order: Order): string[] =>
  buildReceipt(order)
    // Each command is stripped at its own length — one pattern loose enough to
    // cover them all swallows the first byte of whatever follows.
    .replace(/\x1B@|\x1B[aE].|\x1D!.|\x1DV../g, "")
    .split("\n")

const paper = (order: Order) => printed(order).join("\n")

/** The one printed line beginning with `prefix`, or "" if there is none. */
const lineFrom = (order: Order, prefix: string) =>
  printed(order).find((text) => text.startsWith(prefix)) ?? ""

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(NOW)
})

afterEach(() => {
  jest.useRealTimers()
})

describe("wrap", () => {
  it("breaks on spaces", () => {
    expect(wrap("Mango Sago with extra taro", 12)).toEqual([
      "Mango Sago",
      "with extra",
      "taro",
    ])
  })

  // Left to the printer, an over-long word wraps without the indent that
  // marks a customisation as belonging to the dessert above it.
  it("cuts a word that cannot fit", () => {
    expect(wrap("Supercalifragilistic", 8)).toEqual([
      "Supercal",
      "ifragili",
      "stic",
    ])
  })

  it("always gives back at least one line", () => {
    expect(wrap("", 10)).toEqual([""])
  })
})

describe("row", () => {
  it("puts the figure at the right margin", () => {
    expect(row("Includes GST", "$3.13")).toEqual([
      "Includes GST               $3.13",
    ])
    expect(row("Includes GST", "$3.13")[0]).toHaveLength(COLUMNS)
  })

  it("wraps a long label and keeps the figure on the last line", () => {
    const lines = row("1x Black Sesame Soup with Taro", "$18.00")

    expect(lines).toEqual([
      "1x Black Sesame Soup with",
      "Taro                      $18.00",
    ])
  })

  // The label is wrapped to leave room for the figure, so the only way to run
  // out is a figure wider than the line itself. It then takes its own.
  it("drops the figure to its own line when there is no room", () => {
    const lines = row("Total", "$1,234,567.89", 12)

    expect(lines[lines.length - 1]).toBe("$1,234,567.89")
  })
})

describe("buildReceipt", () => {
  it("leads with the shop, the kind of order and its number", () => {
    const lines = printed(makeOrder()).filter(Boolean)

    expect(lines.slice(0, 5)).toEqual([
      "EVERSWEET",
      "5D/119 Meadowland Drive",
      "Somerville, Auckland 2014",
      "TAKE AWAY",
      "#6015",
    ])
  })

  it("says when an order is eaten in", () => {
    const text = paper(makeOrder({ dineIn: true }))

    expect(text).toContain("EAT IN")
    expect(text).toContain("Eat in at")
    expect(text).not.toContain("TAKE AWAY")
  })

  // The two things anyone picks the docket up to find.
  it("prints the order number and the collection time at title size", () => {
    const receipt = buildReceipt(makeOrder())

    expect(receipt).toContain(SIZE_TITLE + BOLD_ON + "#6015")
    expect(receipt).toContain("2:45pm")
  })

  it("prices each dessert on its own line", () => {
    const line = lineFrom(makeOrder(), "2x Mango Sago")

    expect(line).toMatch(/\$24\.00$/)
    expect(line).toHaveLength(COLUMNS)
  })

  it("charges what was added and nothing for what was left out", () => {
    const order = makeOrder({
      desserts: [
        makeItem("Grass Jelly", 1, 1200, [
          { name: "Taro", quantity: 2, priceInCents: 150 },
          { name: "Ice", quantity: 0, priceInCents: 900 },
        ]),
      ],
    })

    const text = paper(order)

    // 1200 + 2 x 150, with the removed ice costing nothing.
    expect(lineFrom(order, "1x Grass Jelly")).toMatch(/\$15\.00$/)
    expect(text).toContain("   +2 Taro")
    expect(text).toContain("   No Ice")
  })

  it("keeps every line inside the paper", () => {
    const order = makeOrder({
      desserts: [
        makeItem("Black Sesame Soup with Glutinous Rice Balls", 3, 1450, [
          { name: "Condensed Milk Drizzle", quantity: 2, priceInCents: 120 },
        ]),
      ],
    })

    for (const line of printed(order)) {
      expect(line.length).toBeLessThanOrEqual(COLUMNS)
    }
  })

  it("shows a discount only when there is one", () => {
    expect(paper(makeOrder())).not.toContain("Discount")

    const order = makeOrder({
      priceInCents: 2400,
      discountedAmountInCents: 400,
    })

    expect(lineFrom(order, "Items")).toMatch(/\$24\.00$/)
    expect(lineFrom(order, "Discount")).toMatch(/-\$4\.00$/)
    expect(lineFrom(order, "TOTAL")).toBe("TOTAL     $20.00")
  })

  // GST is inside the price, so it is stated rather than added on.
  it("states the total once, with the GST inside it", () => {
    const order = makeOrder()

    expect(lineFrom(order, "TOTAL")).toBe("TOTAL     $24.00")
    expect(lineFrom(order, "Includes GST")).toMatch(/\$3\.13$/)
    expect(paper(order)).not.toContain("Subtotal")
  })

  it("stays printable ASCII", () => {
    const order = makeOrder({
      desserts: [makeItem("Mango Sago", 2, 1200, [{ name: "Ice", quantity: 0 }])],
    })

    // Anything outside printable ASCII is a byte these printers render as
    // something else — and a stray control code left in the text would show
    // up here too.
    expect(paper(order)).not.toMatch(/[^\x20-\x7E\n]/)
  })

  it("cuts the paper at the end", () => {
    expect(buildReceipt(makeOrder()).endsWith(CUT_PAPER)).toBe(true)
  })
})

describe("times", () => {
  it("reads as a wall clock", () => {
    expect(formatTimeOfDay(new Date("2026-03-02T14:45:00+13:00"))).toBe("2:45pm")
    expect(formatTimeOfDay(new Date("2026-03-02T09:05:00+13:00"))).toBe("9:05am")
  })

  // Midnight and noon are the two the twelve-hour clock gets wrong.
  it("handles midnight and midday", () => {
    expect(formatTimeOfDay(new Date("2026-03-02T00:30:00+13:00"))).toBe(
      "12:30am",
    )
    expect(formatTimeOfDay(new Date("2026-03-02T12:00:00+13:00"))).toBe(
      "12:00pm",
    )
  })

  it("dates a stamp without a year", () => {
    expect(formatStamp(new Date("2026-03-02T14:45:00+13:00"))).toBe(
      "02/03 2:45pm",
    )
  })

  // A receipt must still print when the server sends a time that will not
  // parse; a crash here loses the order the kitchen was about to make.
  it("survives an unusable date", () => {
    expect(formatTimeOfDay(new Date("nonsense"))).toBe("--:--")
    expect(formatStamp(new Date("nonsense"))).toBe("--")
  })
})
