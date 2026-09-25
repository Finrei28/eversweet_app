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

import {
  ApiError,
  apiFetch,
  apiRequest,
  AppUpdateRequiredError,
} from "@/services/apiClient"
import { useAppUpdateStore } from "@/store/appUpdate"

/**
 * React Native's own Headers.get ignores case. A stub that did not would let a
 * test pass against "X-App-Update-Recommended" while the device, which lower
 * cases it, saw nothing.
 */
const respond = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) => {
  const lowered = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  )

  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: (name: string) => lowered[name.toLowerCase()] ?? null },
  }
}

const fetchMock = jest.fn()
global.fetch = fetchMock as unknown as typeof fetch

const sentHeaders = () => fetchMock.mock.calls[0][1].headers as Record<string, string>

const REFUSAL = {
  code: "APP_UPDATE_REQUIRED",
  message: "Please update the Eversweet app to keep ordering.",
}

beforeEach(() => {
  fetchMock.mockReset()
  useAppUpdateStore.setState({
    status: "ok",
    recommendedBuild: null,
    dismissedBuild: null,
  })
})

describe("apiFetch", () => {
  it("sends the build number and platform on every request", async () => {
    fetchMock.mockResolvedValue(respond(200, {}))

    await apiRequest("/api/getStoreHours")

    expect(sentHeaders()["X-App-Build"]).toBe("114")
    expect(sentHeaders()["X-App-Platform"]).toBe("ios")
  })

  it("marks the app as needing an update when the server refuses the build", async () => {
    fetchMock.mockResolvedValue(respond(426, REFUSAL))

    await expect(apiRequest("/api/getStoreHours")).rejects.toThrow()

    expect(useAppUpdateStore.getState().status).toBe("required")
  })

  it("records the build the server recommends", async () => {
    fetchMock.mockResolvedValue(
      respond(200, {}, { "X-App-Update-Recommended": "120" }),
    )

    await apiRequest("/api/getStoreHours")

    expect(useAppUpdateStore.getState()).toMatchObject({
      status: "recommended",
      recommendedBuild: 120,
    })
  })

  // The only thing that ever lifts the wall: once it is up nothing else in the
  // app is fetching to notice that the server has changed its mind.
  it("clears a refusal the server has stopped making", async () => {
    useAppUpdateStore.setState({ status: "required" })
    fetchMock.mockResolvedValue(respond(200, {}))

    await apiRequest("/api/getStoreInfo")

    expect(useAppUpdateStore.getState().status).toBe("ok")
  })

  it("clears a recommendation the server has stopped sending", async () => {
    useAppUpdateStore.setState({ status: "recommended", recommendedBuild: 120 })
    fetchMock.mockResolvedValue(respond(200, {}))

    await apiRequest("/api/getStoreInfo")

    expect(useAppUpdateStore.getState()).toMatchObject({
      status: "ok",
      recommendedBuild: null,
    })
  })

  it("ignores a recommendation it cannot read as a build number", async () => {
    fetchMock.mockResolvedValue(
      respond(200, {}, { "X-App-Update-Recommended": "soon" }),
    )

    await apiRequest("/api/getStoreHours")

    expect(useAppUpdateStore.getState().status).toBe("ok")
  })

  it("leaves the update state alone when the request never got an answer", async () => {
    // An update cannot be applied without a connection either, so a launch with
    // no signal has to behave exactly as it did before any of this existed.
    useAppUpdateStore.setState({ status: "recommended", recommendedBuild: 120 })
    fetchMock.mockRejectedValue(
      Object.assign(new Error("Aborted"), { name: "AbortError" }),
    )

    await expect(apiFetch("/api/getStoreHours")).rejects.toThrow()

    expect(useAppUpdateStore.getState()).toMatchObject({
      status: "recommended",
      recommendedBuild: 120,
    })
  })
})

describe("apiRequest", () => {
  it("throws an error the query client will not retry when the build is refused", async () => {
    fetchMock.mockResolvedValue(respond(426, REFUSAL))

    await expect(apiRequest("/api/getStoreHours")).rejects.toBeInstanceOf(
      AppUpdateRequiredError,
    )
  })

  it("does not report a refused build as a failed request in development", async () => {
    // A blocked launch refuses every one of its dozen requests, and each logged
    // one used to be a redbox over the update screen.
    const errors = jest.spyOn(console, "error").mockImplementation(() => {})
    fetchMock.mockResolvedValue(respond(426, REFUSAL))

    await expect(apiRequest("/api/getStoreHours")).rejects.toThrow()

    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })
})

describe("a failed request", () => {
  /**
   * Every failure was a plain Error, so a 404 for a cart line the server had already
   * removed could not be told from a real failure, and the app put the line back.
   */
  it("carries its status, and is still an Error", async () => {
    fetchMock.mockResolvedValueOnce(respond(404, { message: "cart item not found" }))

    const failure = await apiRequest("/api/cart/removeItemFromCart/x", {
      method: "DELETE",
      statusMessages: { 404: "Not found" },
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ApiError)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as ApiError).status).toBe(404)
    expect((failure as ApiError).message).toBe("Not found")
  })
})
