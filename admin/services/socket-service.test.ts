import { Order } from "@/lib/types"
import { useOrderStore } from "@/store/order-store"

// socket.io-client is never reached: these tests call the handlers directly
// rather than standing up a connection.
jest.mock("socket.io-client", () => ({ io: jest.fn() }))
jest.mock("./auth", () => ({ getToken: jest.fn(async () => null) }))
jest.mock("./newOrders-service", () => ({
  __esModule: true,
  default: { enqueue: jest.fn() },
}))

// Pulled in by the order store, and irrelevant here.
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

import newOrderServices from "./newOrders-service"
import { handleNewOrder, handleOrderReceived } from "./socket-service"

const enqueue = newOrderServices.enqueue as jest.Mock

const makeOrder = (over: Partial<Order> = {}): Order =>
  ({
    id: "order-1",
    tempOrderId: "6001",
    status: "PENDING",
    pickUpTime: new Date("2026-03-02T12:30:00+13:00"),
    dueAt: "2026-03-02T12:19:00.000+13:00",
    desserts: [{ quantity: 2 }],
    ...over,
  }) as unknown as Order

beforeEach(() => {
  useOrderStore.getState().reset()
  enqueue.mockClear()
})

describe("handleOrderReceived", () => {
  it("puts the order on the Upcoming list without alarming", () => {
    handleOrderReceived(makeOrder())

    expect(useOrderStore.getState().pendingOrders).toHaveLength(1)
    expect(enqueue).not.toHaveBeenCalled()
  })

  // The website retries, and the server re-sends a receipt each time.
  it("updates the order it already holds rather than adding a second", () => {
    handleOrderReceived(makeOrder())
    handleOrderReceived(makeOrder({ dueAt: "2026-03-02T12:25:00.000+13:00" }))

    const { pendingOrders } = useOrderStore.getState()
    expect(pendingOrders).toHaveLength(1)
    expect(pendingOrders[0].dueAt).toBe("2026-03-02T12:25:00.000+13:00")
  })

  it("ignores an order already accepted on another device", () => {
    useOrderStore.setState({
      currentOrders: [makeOrder({ status: "ACCEPTED" })],
    })

    handleOrderReceived(makeOrder())

    expect(useOrderStore.getState().pendingOrders).toHaveLength(0)
  })
})

describe("handleNewOrder", () => {
  it("alarms for an order it has not alarmed for", () => {
    handleNewOrder(makeOrder())

    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(useOrderStore.getState().pendingOrders).toHaveLength(1)
  })

  /**
   * The regression this split nearly introduced.
   *
   * A receipt puts the order in `pendingOrders` the moment it is paid for. The
   * de-dup guard used to ask "do we know this order?", which after the receipt
   * is always yes — so every alarm would have been swallowed and the kitchen
   * would never have been told to start anything.
   */
  it("still alarms after a receipt for the same order", () => {
    handleOrderReceived(makeOrder())
    expect(enqueue).not.toHaveBeenCalled()

    handleNewOrder(makeOrder())

    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(useOrderStore.getState().pendingOrders).toHaveLength(1)
  })

  // The sweep re-emits every couple of minutes until staff accept.
  it("alarms once however many times the sweep re-sends it", () => {
    handleNewOrder(makeOrder())
    handleNewOrder(makeOrder())
    handleNewOrder(makeOrder())

    expect(enqueue).toHaveBeenCalledTimes(1)
  })

  it("does not alarm for an order already accepted", () => {
    useOrderStore.setState({
      currentOrders: [makeOrder({ status: "ACCEPTED" })],
    })

    handleNewOrder(makeOrder())

    expect(enqueue).not.toHaveBeenCalled()
  })

  it("does not alarm for an order already picked up", () => {
    useOrderStore.setState({
      completedOrders: [makeOrder({ status: "PICKED_UP" })],
    })

    handleNewOrder(makeOrder())

    expect(enqueue).not.toHaveBeenCalled()
  })

  // A fresh session has to be able to be alarmed about orders still waiting,
  // so signing out must not leave the guard armed.
  it("can alarm again after a reset", () => {
    handleNewOrder(makeOrder())
    useOrderStore.getState().reset()
    handleNewOrder(makeOrder())

    expect(enqueue).toHaveBeenCalledTimes(2)
  })
})
