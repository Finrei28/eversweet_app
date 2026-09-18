import {
  act,
  create,
  ReactTestInstance,
  ReactTestRenderer,
} from "react-test-renderer"

jest.mock("@expo/vector-icons", () => ({ Feather: "Feather" }))

// expo-application reads constants out of the native binary.
jest.mock("expo-application", () => ({
  nativeBuildVersion: "114",
  nativeApplicationVersion: "1.0.0",
}))

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)

// Nothing here should reach the network; the re-check is counted, not made.
const mockApiFetch = jest.fn()
jest.mock("@/services/apiClient", () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}))

import { Alert, Linking, Platform } from "react-native"
import UpdateRequiredScreen from "./updateRequiredScreen"

const stringsIn = (node: ReactTestInstance | string): string[] =>
  typeof node === "string" ? [node] : node.children.flatMap(stringsIn)

const textOf = (tree: ReactTestRenderer) => stringsIn(tree.root).join(" | ")

const pressableSaying = (tree: ReactTestRenderer, label: string) =>
  tree.root
    .findAll((node) => typeof node.props?.onPress === "function")
    .filter((node) => stringsIn(node).some((text) => text.includes(label)))
    .sort(
      (a, b) => stringsIn(a).join("").length - stringsIn(b).join("").length,
    )[0]

const render = () => {
  let tree!: ReactTestRenderer
  act(() => {
    tree = create(<UpdateRequiredScreen />)
  })
  return tree
}

const press = async (tree: ReactTestRenderer, label: string) => {
  await act(async () => {
    pressableSaying(tree, label).props.onPress()
  })
}

const onPlatform = (os: string, run: () => Promise<void>) => {
  const original = Platform.OS
  Object.defineProperty(Platform, "OS", { value: os, configurable: true })
  return run().finally(() => {
    Object.defineProperty(Platform, "OS", {
      value: original,
      configurable: true,
    })
  })
}

let openURL: jest.SpiedFunction<typeof Linking.openURL>
let alert: jest.SpiedFunction<typeof Alert.alert>

beforeEach(() => {
  mockApiFetch.mockReset().mockResolvedValue({ res: { ok: true }, data: {} })
  openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true)
  alert = jest.spyOn(Alert, "alert").mockImplementation(() => {})
})

afterEach(() => {
  openURL.mockRestore()
  alert.mockRestore()
})

describe("the update wall", () => {
  it("says why the app has stopped, in its own words", () => {
    // Deliberately not the server's message: the same code is sent by
    // createPaymentIntent, whose wording is about paying by card.
    const text = textOf(render())

    expect(text).toContain("Time to update Eversweet")
    expect(text).toContain("no longer supported")
  })

  it("opens the store over https, not a scheme Android will not answer for", async () => {
    // market:// is not on Android's default query allowlist, so the canOpenURL
    // guard used elsewhere in the app would refuse it on every modern phone.
    await press(render(), "Update now")

    expect(openURL).toHaveBeenCalledTimes(1)
    expect(openURL.mock.calls[0][0]).toMatch(/^https:\/\//)
  })

  it("sends an iPhone to the App Store and an Android phone to Google Play", async () => {
    await onPlatform("ios", async () => {
      await press(render(), "Update now")
      expect(openURL.mock.calls[0][0]).toContain("apps.apple.com")
    })

    await onPlatform("android", async () => {
      await press(render(), "Update now")
      expect(openURL.mock.calls[1][0]).toContain("play.google.com")
    })
  })

  it("tells the customer when the store cannot be opened", async () => {
    openURL.mockRejectedValueOnce(new Error("no handler"))

    await press(render(), "Update now")

    expect(alert).toHaveBeenCalled()
  })

  it("lets the customer say they have already updated", async () => {
    // The only way off this screen inside a session, for a minimum that was
    // raised by mistake: nothing else is fetching while the wall is up.
    await press(render(), "already updated")

    expect(mockApiFetch).toHaveBeenCalledTimes(1)
  })

  it("stays put when the re-check fails", async () => {
    mockApiFetch.mockRejectedValueOnce(new Error("still refused"))
    const tree = render()

    await press(tree, "already updated")

    expect(textOf(tree)).toContain("Time to update Eversweet")
  })
})
