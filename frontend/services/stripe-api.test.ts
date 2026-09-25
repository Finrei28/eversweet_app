// expo-application reads native constants that do not exist under jest.
jest.mock("expo-application", () => ({
  nativeBuildVersion: "114",
  nativeApplicationVersion: "1.0.0",
}))

// Reading the token crosses the native bridge into SecureStore.
jest.mock("@/services/authToken", () => ({
  getToken: jest.fn(async () => "test-token"),
}))

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)

import { ApiError } from "@/services/apiClient"
import {
  PaymentAuthenticationRequiredError,
  retryPayment,
} from "@/services/stripe-api"

const respond = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  headers: { get: () => null },
})

const fetchMock = jest.fn()
global.fetch = fetchMock as unknown as typeof fetch

beforeEach(() => {
  fetchMock.mockReset()
})

/**
 * A held renewal is retried off-session, and a bank that wants the member to confirm it
 * is them declined it every time. The server now hands the payment back; this is the
 * app's side of reading it.
 */
describe("retryPayment", () => {
  it("returns the bank's check for the screen to show", async () => {
    fetchMock.mockResolvedValueOnce(
      respond(402, {
        code: "AUTHENTICATION_REQUIRED",
        message: "Your card was declined. This transaction requires authentication.",
        clientSecret: "pi_renewal_secret_abc",
        paymentMethodId: "pm_member_card",
      }),
    )

    const failure = await retryPayment().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(PaymentAuthenticationRequiredError)
    expect(failure).toMatchObject({
      clientSecret: "pi_renewal_secret_abc",
      paymentMethodId: "pm_member_card",
    })
  })

  it("leaves an ordinary decline as a failure with the card's message", async () => {
    fetchMock.mockResolvedValueOnce(
      respond(500, { message: "Your card has insufficient funds." }),
    )

    const failure = await retryPayment().catch((error: unknown) => error)

    expect(failure).not.toBeInstanceOf(PaymentAuthenticationRequiredError)
    expect(failure).toBeInstanceOf(ApiError)
    expect((failure as Error).message).toBe("Your card has insufficient funds.")
  })

  it("returns a paid retry as before", async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { success: true }))

    await expect(retryPayment()).resolves.toBe(true)
  })
})
