import { Order } from "@/lib/types"
import { useOrderStore } from "@/store/order-store"
import { useEffect } from "react"

/**
 * Fake orders for the Upcoming panel, so it can be looked at without a real
 * one being placed.
 *
 * Off by default and dead in a release build: flip `MOCK_UPCOMING` to true,
 * reload, and four orders appear on Current Orders — one already due, one a
 * few minutes out, one later in the hour, one this afternoon — covering the
 * amber "Start now" tone, every shape of countdown label, and the
 * collapsed/expanded states.
 */
export const MOCK_UPCOMING = false

const MINUTE = 60_000

/** Pick-up sits after the start time, the way the server spaces them. */
const PREP_MINUTES = 11

type Line = Order["desserts"][number]

const makeLine = (
  orderId: string,
  index: number,
  name: string,
  chineseName: string,
  quantity: number,
  priceInCents: number,
  /** `[name, chineseName, priceInCents, quantity]` — 0 means "leave it out". */
  customisations: [string, string, number, number][] = [],
): Line => ({
  id: `${orderId}-line-${index}`,
  orderId,
  quantity,
  priceInCents,
  discountedAmountInCents: 0,
  offerId: "",
  dessert: {
    id: `${orderId}-dessert-${index}`,
    name,
    chineseName,
    imagePath: "",
  },
  customisations: customisations.map(
    ([cName, cChinese, cPrice, cQuantity], cIndex) => ({
      id: `${orderId}-line-${index}-cust-${cIndex}`,
      quantity: cQuantity,
      discountedAmountInCents: 0,
      customisation: {
        id: `${orderId}-cust-${cIndex}`,
        name: cName,
        chineseName: cChinese,
        priceInCents: cPrice,
      },
    }),
  ),
})

const makeOrder = (
  id: string,
  tempOrderId: string,
  minutesUntilStart: number,
  fields: {
    customerFirstName: string
    customerLastName: string
    customerPhoneNumber: string | null
    dineIn: boolean
    priceInCents: number
    discountedAmountInCents: number
    desserts: (orderId: string) => Line[]
  },
  now: number,
): Order => {
  const dueAt = new Date(now + minutesUntilStart * MINUTE)

  return {
    id,
    tempOrderId,
    priceInCents: fields.priceInCents,
    discountedAmountInCents: fields.discountedAmountInCents,
    GST: Math.round(
      (fields.priceInCents - fields.discountedAmountInCents) * 0.15,
    ),
    createdAt: new Date(now - 6 * MINUTE),
    customerFirstName: fields.customerFirstName,
    customerLastName: fields.customerLastName,
    customerEmail: `${fields.customerFirstName.toLowerCase()}@example.com`,
    customerPhoneNumber: fields.customerPhoneNumber,
    pickedUpAt: null,
    pickUpTime: new Date(dueAt.getTime() + PREP_MINUTES * MINUTE),
    dineIn: fields.dineIn,
    appUserId: `mock-user-${tempOrderId}`,
    status: "PENDING",
    dueAt: dueAt.toISOString(),
    desserts: fields.desserts(id),
  }
}

/**
 * Built off the current clock, so the countdowns tick like real ones.
 *
 * The four start times are chosen to cover every shape the label takes:
 * due now, inside the mm:ss window, whole minutes, and hours.
 */
export const mockUpcomingOrders = (now: number = Date.now()): Order[] => [
  makeOrder(
    "mock-order-1",
    "6014",
    0,
    {
      customerFirstName: "Mei",
      customerLastName: "Chen",
      customerPhoneNumber: "021 555 0134",
      dineIn: false,
      priceInCents: 2300,
      discountedAmountInCents: 300,
      desserts: (orderId) => [
        makeLine(orderId, 1, "Mango Sago", "芒果西米露", 2, 1500, [
          ["Mango", "芒果", 100, 2],
          ["Ice", "冰", 0, 0],
        ]),
        makeLine(orderId, 2, "Black Sesame Soup", "芝麻糊", 1, 800),
      ],
    },
    now,
  ),
  // The only one inside the mm:ss window — the ticking clock to look at.
  makeOrder(
    "mock-order-2",
    "6015",
    4,
    {
      customerFirstName: "Jordan",
      customerLastName: "Blake",
      customerPhoneNumber: null,
      dineIn: true,
      priceInCents: 1200,
      discountedAmountInCents: 0,
      desserts: (orderId) => [
        makeLine(orderId, 1, "Grass Jelly", "烧仙草", 1, 1200, [
          ["Taro", "芋圆", 150, 1],
        ]),
      ],
    },
    now,
  ),
  makeOrder(
    "mock-order-3",
    "6016",
    42,
    {
      customerFirstName: "Tane",
      customerLastName: "Walker",
      customerPhoneNumber: "027 555 0176",
      dineIn: true,
      priceInCents: 1900,
      discountedAmountInCents: 0,
      desserts: (orderId) => [
        makeLine(orderId, 1, "Taro Sago", "芋头西米露", 1, 1300),
        makeLine(orderId, 2, "Coconut Jelly", "椰汁糕", 1, 600),
      ],
    },
    now,
  ),
  makeOrder(
    "mock-order-4",
    "6017",
    135,
    {
      customerFirstName: "Priya",
      customerLastName: "Raman",
      customerPhoneNumber: "022 555 0198",
      dineIn: false,
      priceInCents: 5400,
      discountedAmountInCents: 0,
      desserts: (orderId) => [
        makeLine(orderId, 1, "Durian Pancake", "榴莲班戟", 3, 2700),
        makeLine(orderId, 2, "Red Bean Soup", "红豆沙", 2, 1600, [
          ["Peanuts", "花生", 0, 0],
        ]),
        makeLine(orderId, 3, "Coconut Jelly", "椰汁糕", 1, 1100),
      ],
    },
    now,
  ),
]

/**
 * Keeps the mocks on the Upcoming list for as long as the flag is on.
 *
 * Re-seeds rather than seeding once: the launch fetch and every reconnect
 * replace `pendingOrders` wholesale, which would otherwise wipe the preview a
 * second after it appeared. Settles as soon as they are all present.
 */
export function useMockUpcomingOrders() {
  const pendingOrders = useOrderStore((state) => state.pendingOrders)

  useEffect(() => {
    if (!__DEV__ || !MOCK_UPCOMING) return

    const missing = mockUpcomingOrders().filter(
      (mock) => !pendingOrders.some((order) => order.id === mock.id),
    )
    if (missing.length === 0) return

    const { upsertPendingOrder, markAlerted } = useOrderStore.getState()
    missing.forEach((order) => {
      // Marked as already alarmed so the sweep does not fire the new-order
      // modal and the printer at a fake order.
      markAlerted(order.id)
      upsertPendingOrder(order)
    })
  }, [pendingOrders])
}
