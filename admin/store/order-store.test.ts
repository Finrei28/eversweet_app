import { Order } from "@/lib/types"
import { useOrderStore } from "@/store/order-store"

jest.mock("@/services/api", () => ({
  getCurrentOrders: jest.fn(async () => []),
  getPastOrders: jest.fn(async () => []),
  getPendingOrders: jest.fn(async () => []),
  updateOrderStatusAPI: jest.fn(async () => {}),
}))
jest.mock("@/services/printer-service", () => ({
  __esModule: true,
  default: { enqueue: jest.fn(), retryPendingJobs: jest.fn() },
  addJob: jest.fn(async () => {}),
}))
jest.mock("react-native-toast-message", () => ({
  __esModule: true,
  default: { show: jest.fn() },
}))

import { updateOrderStatusAPI } from "@/services/api"
import printerService from "@/services/printer-service"

const api = updateOrderStatusAPI as jest.Mock
const print = printerService.enqueue as jest.Mock

const order = {
  id: "order-1",
  tempOrderId: "6001",
  status: "PENDING",
  appUserId: null,
  pickUpTime: new Date("2026-03-02T12:30:00+13:00"),
  dueAt: "2026-03-02T12:19:00.000+13:00",
  desserts: [{ quantity: 2 }],
} as unknown as Order

/** An order sitting in the Upcoming list, already alarmed for. */
const givenAlertedPendingOrder = () => {
  const store = useOrderStore.getState()
  store.upsertPendingOrder(order)
  store.markAlerted(order.id)
}

beforeEach(() => {
  useOrderStore.getState().reset()
  api.mockReset().mockResolvedValue(undefined)
  print.mockClear()
})

describe("updateOrderStatus, accepting an order", () => {
  it("reports success and takes the order off the Upcoming list", async () => {
    givenAlertedPendingOrder()

    const accepted = await useOrderStore
      .getState()
      .updateOrderStatus(order.id, "ACCEPTED")

    expect(accepted).toBe(true)

    const state = useOrderStore.getState()
    expect(state.pendingOrders).toHaveLength(0)
    expect(state.currentOrders.map((o) => o.id)).toEqual(["order-1"])
  })

  // The guard exists to stop the sweep re-alarming an order staff already
  // took. Once the server has it, it must keep holding.
  it("keeps the alerted mark once the server has recorded it", async () => {
    givenAlertedPendingOrder()

    await useOrderStore.getState().updateOrderStatus(order.id, "ACCEPTED")

    expect(useOrderStore.getState().hasAlerted(order.id)).toBe(true)
  })

  it("reports failure rather than throwing", async () => {
    givenAlertedPendingOrder()
    api.mockRejectedValue(new Error("Network request failed"))

    await expect(
      useOrderStore.getState().updateOrderStatus(order.id, "ACCEPTED"),
    ).resolves.toBe(false)
  })

  /**
   * The regression this file exists for.
   *
   * The accept never reached the server, so the order is still PENDING and
   * un-notified there and the sweep will re-emit it. If the alerted mark stays,
   * `handleNewOrder` swallows that re-emit and the order is never alarmed or
   * printed again — it sits silently in the Upcoming list until someone
   * restarts the app.
   */
  it("releases the alerted mark when the accept fails", async () => {
    givenAlertedPendingOrder()
    api.mockRejectedValue(new Error("Network request failed"))

    await useOrderStore.getState().updateOrderStatus(order.id, "ACCEPTED")

    expect(useOrderStore.getState().hasAlerted(order.id)).toBe(false)
  })

  it("leaves a failed order on the Upcoming list, unaccepted", async () => {
    givenAlertedPendingOrder()
    api.mockRejectedValue(new Error("Network request failed"))

    await useOrderStore.getState().updateOrderStatus(order.id, "ACCEPTED")

    const state = useOrderStore.getState()
    expect(state.pendingOrders.map((o) => o.id)).toEqual(["order-1"])
    expect(state.currentOrders).toHaveLength(0)
  })

  // Printing sits behind the accept, so a receipt must not be produced for an
  // order the shop has not actually taken.
  it("does not queue a print when the accept fails", async () => {
    givenAlertedPendingOrder()
    api.mockRejectedValue(new Error("Network request failed"))

    await useOrderStore.getState().updateOrderStatus(order.id, "ACCEPTED")

    expect(print).not.toHaveBeenCalled()
  })

  it("reports failure for an order it does not know about", async () => {
    await expect(
      useOrderStore.getState().updateOrderStatus("missing", "ACCEPTED"),
    ).resolves.toBe(false)
    expect(api).not.toHaveBeenCalled()
  })
})

describe("clearAlerted", () => {
  it("lets the same order be alarmed again", () => {
    const store = useOrderStore.getState()

    store.markAlerted("order-1")
    expect(store.hasAlerted("order-1")).toBe(true)

    store.clearAlerted("order-1")
    expect(store.hasAlerted("order-1")).toBe(false)
  })

  it("leaves other orders alone", () => {
    const store = useOrderStore.getState()

    store.markAlerted("order-1")
    store.markAlerted("order-2")
    store.clearAlerted("order-1")

    expect(store.hasAlerted("order-1")).toBe(false)
    expect(store.hasAlerted("order-2")).toBe(true)
  })
})
