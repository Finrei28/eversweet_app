import { Order } from "@/lib/types"
import { act, create, ReactTestRenderer } from "react-test-renderer"

// The real icon set loads its font asynchronously and sets state when it
// lands, which arrives as an act() warning long after a test has finished.
// Nothing here is about the icons.
jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }))

import { UpcomingOrders } from "./upcoming-orders"

const NOW = new Date("2026-03-02T14:00:00+13:00")

const makeOrder = (
  id: string,
  tempOrderId: string,
  minutesUntilStart: number,
  over: Partial<Order> = {},
): Order =>
  ({
    id,
    tempOrderId,
    customerFirstName: "Ada",
    customerLastName: "Lovelace",
    priceInCents: 2400,
    discountedAmountInCents: 0,
    dineIn: false,
    pickUpTime: new Date(NOW.getTime() + (minutesUntilStart + 11) * 60_000),
    dueAt: new Date(NOW.getTime() + minutesUntilStart * 60_000).toISOString(),
    status: "PENDING",
    desserts: [
      {
        id: `${id}-line`,
        quantity: 2,
        dessert: { name: "Mango Sago" },
        customisations: [],
      },
    ],
    ...over,
  }) as unknown as Order

/** Every string rendered anywhere in the tree. */
const textsOf = (renderer: ReactTestRenderer): string[] => {
  const out: string[] = []
  const walk = (node: unknown): void => {
    if (node == null) return
    if (typeof node === "string") {
      out.push(node)
      return
    }
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    const children = (node as { children?: unknown }).children
    if (children) walk(children)
  }
  walk(renderer.toJSON())
  return out
}

/**
 * Joined with nothing between them: React splits interpolated text into
 * separate nodes, so `#{tempOrderId}` arrives as "#" and "6001" and any
 * separator would break a search for "#6001".
 */
const joined = (renderer: ReactTestRenderer) =>
  textsOf(renderer).join("").replace(/\s+/g, " ")

const toggle = (renderer: ReactTestRenderer) => {
  const header = renderer.root.find(
    (node) =>
      typeof node.props.accessibilityLabel === "string" &&
      node.props.accessibilityLabel.startsWith("Upcoming orders"),
  )
  act(() => {
    header.props.onPress()
  })
}

let renderer: ReactTestRenderer

const render = (orders: Order[]) => {
  jest.useFakeTimers().setSystemTime(NOW)
  act(() => {
    renderer = create(<UpcomingOrders orders={orders} />)
  })
  return renderer
}

afterEach(() => {
  act(() => renderer?.unmount())
  jest.useRealTimers()
})

describe("UpcomingOrders", () => {
  it("renders nothing when there is nothing coming", () => {
    expect(render([]).toJSON()).toBeNull()
  })

  describe("with a single order", () => {
    it("shows it without a dropdown", () => {
      const view = render([makeOrder("a", "6001", 4)])
      const text = joined(view)

      expect(text).toContain("Upcoming")
      expect(text).toContain("#6001")
      expect(text).toContain("Starts in 04:00")
      // No count pill and nothing to expand into.
      expect(text).not.toContain("orders")
      expect(text).not.toContain("more")
    })

    /**
     * There is no dropdown to open on a single order, so if the lead card did
     * not carry its own dessert lines there would be no way to see them at all.
     */
    it("shows what is in it without needing to expand", () => {
      expect(joined(render([makeOrder("a", "6001", 4)]))).toContain(
        "2× Mango Sago",
      )
    })

    /**
     * A quantity of 0 on a customisation means the customer wants that
     * ingredient left out. Shown as a number it is indistinguishable from an
     * addition at a glance, and getting it wrong means remaking the dessert.
     */
    it("says which ingredients to leave out and which to add", () => {
      const order = {
        ...makeOrder("a", "6001", 4),
        desserts: [
          {
            id: "line",
            quantity: 1,
            dessert: { name: "Grass Jelly" },
            customisations: [
              { id: "c1", quantity: 0, customisation: { name: "Ice" } },
              { id: "c2", quantity: 2, customisation: { name: "Taro" } },
            ],
          },
        ],
      } as unknown as Order

      const text = joined(render([order]))
      expect(text).toContain("No Ice")
      expect(text).toContain("+2 Taro")
    })

    it("is not pressable", () => {
      const view = render([makeOrder("a", "6001", 4)])
      const header = view.root.find(
        (node) =>
          typeof node.props.accessibilityLabel === "string" &&
          node.props.accessibilityLabel.startsWith("Upcoming orders"),
      )

      expect(header.props.disabled).toBe(true)
    })
  })

  describe("with several orders", () => {
    const orders = [
      makeOrder("late", "6003", 40),
      makeOrder("soon", "6001", 4),
      makeOrder("mid", "6002", 20),
    ]

    it("collapses to the one that starts first", () => {
      const text = joined(render(orders))

      expect(text).toContain("#6001")
      expect(text).toContain("Starts in 04:00")
      // Shown in full, dessert lines and all — collapsed hides the other
      // orders, not the detail of the one being counted down.
      expect(text).toContain("2× Mango Sago")
      // The others are behind the dropdown.
      expect(text).not.toContain("#6002")
      expect(text).not.toContain("#6003")
    })

    it("shows how many are waiting", () => {
      const text = joined(render(orders))

      expect(text).toContain("3")
      expect(text).toContain("orders")
      expect(text).toContain("more")
    })

    it("shows every order, soonest first, once opened", () => {
      const view = render(orders)
      toggle(view)

      const text = joined(view)
      expect(text).toContain("#6001")
      expect(text).toContain("#6002")
      expect(text).toContain("#6003")

      const order = ["#6001", "#6002", "#6003"].map((id) => text.indexOf(id))
      expect(order).toEqual([...order].sort((a, b) => a - b))
    })

    it("shows what is in each order once opened", () => {
      const view = render(orders)
      toggle(view)

      expect(joined(view)).toContain("Mango Sago")
    })

    /**
     * The clock lives in the countdown badge, not here. This is what says the
     * panel is not dragged along with it: the badge moves, and the dropdown
     * someone opened stays open while it does.
     */
    it("keeps counting down without disturbing what is open", () => {
      const view = render(orders)
      toggle(view)
      expect(joined(view)).toContain("Starts in 04:00")

      act(() => jest.advanceTimersByTime(5_000))

      const text = joined(view)
      expect(text).toContain("Starts in 03:55")
      expect(text).toContain("#6003")
    })

    it("closes again", () => {
      const view = render(orders)
      toggle(view)
      expect(joined(view)).toContain("#6003")

      toggle(view)
      expect(joined(view)).not.toContain("#6003")
    })
  })

  /**
   * The rule this panel exists to enforce. An upcoming order is one the kitchen
   * must not start, and `OrderCard` puts an Accept button on anything PENDING —
   * which is exactly why these are not rendered with it.
   */
  it("never offers a way to accept an order", () => {
    const view = render([makeOrder("a", "6001", 4), makeOrder("b", "6002", 9)])

    expect(joined(view)).not.toContain("Accept")
    toggle(view)
    expect(joined(view)).not.toContain("Accept")
  })

  it("says an order is due rather than counting down past zero", () => {
    const text = joined(render([makeOrder("a", "6001", -3)]))

    expect(text).toContain("Start now")
  })

  // The server could not work out a start time; the card must still render.
  it("survives an order with no start time", () => {
    const view = render([
      makeOrder("a", "6001", 4, { dueAt: null }),
      makeOrder("b", "6002", 9),
    ])

    // The one that can be timed leads; the unknown sorts last.
    expect(joined(view)).toContain("#6002")
    toggle(view)
    expect(joined(view)).toContain("Start time unknown")
  })
})
