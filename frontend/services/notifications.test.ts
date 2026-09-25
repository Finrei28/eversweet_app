import type * as Notifications from "expo-notifications"

// Only the routing is under test; nothing here registers a token or reaches the server.
jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(),
}))
jest.mock("./apiClient", () => ({ apiRequest: jest.fn() }))
jest.mock("./authToken", () => ({ getToken: jest.fn() }))
jest.mock("./stripe-api", () => ({ getUsersMembership: jest.fn() }))

import { handleNotification } from "./notifications"

const push = (data: Record<string, unknown>) =>
  ({ request: { content: { data } } }) as unknown as Notifications.Notification

const destinationOf = (data: Record<string, unknown>) => {
  const onNavigate = jest.fn()
  handleNotification(push(data), onNavigate)
  return onNavigate.mock.calls.map(([path]) => path)
}

/**
 * Every push the server sends is routed on its `type` alone. A type the app does not know
 * goes nowhere, and one it forgot to route is a push whose tap just opens the app.
 */
describe("handleNotification", () => {
  it.each([
    ["ORDER_STATUS_CHANGED", "/orders"],
    ["NEW_OFFER", "/offers"],
    ["PRIZE_READY", "/offers"],
    ["POINTS_EXPIRING", "/rewards"],
    ["MEMBERSHIP_ENDING", "/membership"],
    ["MEMBERSHIP_PAYMENT_FAILED", "/membership"],
  ])("sends %s to %s", (type, path) => {
    expect(destinationOf({ type })).toEqual([path])
  })

  it("does nothing with a type it does not know", () => {
    expect(destinationOf({ type: "SOMETHING_NEW" })).toEqual([])
    expect(destinationOf({})).toEqual([])
  })
})
