/**
 * Tests for app/(tabs)/redeem-prize.tsx, deliberately not beside it.
 *
 * Expo Router turns every file under app/ into a route and requires it at boot,
 * so a test file there is a screen. This one crashed the app on launch with
 * "Property 'jest' doesn't exist" the moment the router reached it. expo-router
 * ignores only +html, +api and +middleware — there is no test pattern — so
 * nothing under app/ may be a test, however much it wants to sit by its screen.
 */
import {
  act,
  create,
  ReactTestInstance,
  ReactTestRenderer,
} from "react-test-renderer"
import { TextInput } from "react-native"

// The real icon set loads its font asynchronously and sets state when it lands,
// which arrives as an act() warning long after a test has finished.
jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }))

jest.mock("react-native-toast-message", () => ({ show: jest.fn() }))

// Prefixed `mock` because jest hoists the factories below above this file's
// body, and only names in that namespace are allowed to be closed over.
const mockSearchParams: { code?: string } = {}
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockSearchParams,
  // The screen registers a cleanup to clear itself on the way out; running the
  // callback immediately is enough for what these tests assert.
  useFocusEffect: (cb: () => void | (() => void)) => cb(),
}))

jest.mock("@/components/dashboard-header", () => ({
  DashboardHeader: "DashboardHeader",
}))

const mockVerifyPrizeCode = jest.fn()
const mockRedeemPrizeCode = jest.fn()
jest.mock("@/services/api", () => ({
  verifyPrizeCode: (...args: unknown[]) => mockVerifyPrizeCode(...args),
  redeemPrizeCode: (...args: unknown[]) => mockRedeemPrizeCode(...args),
}))

import RedeemPrize from "@/app/(tabs)/redeem-prize"

const CODE = "7K4M-Q92X"

const validCheck = {
  valid: true,
  reason: null,
  message: null,
  winner: {
    id: "w1",
    place: 2,
    month: 8,
    year: 2026,
    points: 640,
    userId: "u1",
    firstName: "Ana",
    lastName: "Ruiz",
    accountClosed: false,
    reward: {
      id: "r1",
      title: "A free tub of mochi",
      description: "Any flavour",
      code: CODE,
      expiresAt: "2026-11-01T00:00:00.000Z",
      redeemedAt: null,
      expired: false,
    },
  },
}

/**
 * Every string rendered under a node.
 *
 * Walks children rather than looking for `Text`, because the preset does not
 * hand back the same component reference the screen imported, so findAllByType
 * matches nothing. Asserting on what a person would read is also the more
 * durable test — it survives the markup being rearranged.
 */
const stringsIn = (node: ReactTestInstance | string): string[] =>
  typeof node === "string" ? [node] : node.children.flatMap(stringsIn)

const textOf = (tree: ReactTestRenderer) => stringsIn(tree.root).join(" | ")

/**
 * The pressable whose label reads `label`, found the way a person finds it.
 *
 * Narrowest match wins. The screen is wrapped in a tap-to-dismiss-the-keyboard
 * TouchableWithoutFeedback, so the outermost node with an `onPress` contains
 * every label on the screen — taking the first match pressed that wrapper and
 * dismissed the keyboard instead of the button, silently doing nothing.
 */
const buttonSaying = (tree: ReactTestRenderer, label: string) => {
  const candidates = tree.root
    .findAll((node) => typeof node.props?.onPress === "function")
    .filter((node) => stringsIn(node).some((text) => text.includes(label)))
    .sort(
      (a, b) => stringsIn(a).join("").length - stringsIn(b).join("").length,
    )

  return candidates[0]
}

const type = async (tree: ReactTestRenderer, value: string) => {
  await act(async () => {
    tree.root.findByType(TextInput).props.onChangeText(value)
  })
}

const press = async (tree: ReactTestRenderer, label: string) => {
  await act(async () => {
    // Awaited: these handlers are async, and without this the assertions run
    // before the request they fire has resolved.
    await buttonSaying(tree, label)!.props.onPress()
  })
}

let tree: ReactTestRenderer

beforeEach(() => {
  delete mockSearchParams.code
  mockVerifyPrizeCode.mockReset().mockResolvedValue(validCheck)
  mockRedeemPrizeCode.mockReset().mockResolvedValue({
    redeemed: true,
    winner: validCheck.winner,
  })
})

afterEach(() => {
  act(() => tree?.unmount())
})

describe("collecting a prize", () => {
  it("will not check an incomplete code", async () => {
    await act(async () => {
      tree = create(<RedeemPrize />)
    })

    // Asserted on the prop rather than by pressing: calling onPress directly
    // would drive straight past the disabled state that actually prevents this.
    expect(buttonSaying(tree, "Check code")!.props.disabled).toBe(true)

    await type(tree, "7K4M")
    expect(buttonSaying(tree, "Check code")!.props.disabled).toBe(true)

    await type(tree, CODE)
    expect(buttonSaying(tree, "Check code")!.props.disabled).toBe(false)
  })

  it("shows who is standing there and what to hand over", async () => {
    await act(async () => {
      tree = create(<RedeemPrize />)
    })
    await type(tree, CODE)
    await press(tree, "Check code")

    const text = textOf(tree)
    expect(text).toContain("Ana Ruiz")
    expect(text).toContain("A free tub of mochi")
    expect(text).toContain("Any flavour")
    expect(text).toContain("2nd place")
  })

  it("says which month it was won", async () => {
    // A customer can be holding prizes from more than one month, and staff may
    // be handing over an old one. "2nd place" alone does not say which.
    await act(async () => {
      tree = create(<RedeemPrize />)
    })
    await type(tree, CODE)
    await press(tree, "Check code")

    expect(textOf(tree)).toContain("August 2026")
  })

  it("shows what they earned and how long they have left", async () => {
    await act(async () => {
      tree = create(<RedeemPrize />)
    })
    await type(tree, CODE)
    await press(tree, "Check code")

    const text = textOf(tree)
    expect(text).toContain("640 points")
    expect(text).toContain("Collectable until")
  })

  it("warns when the winner has closed their account", async () => {
    // A prize assigned before the account closed keeps a live code, so this can
    // be valid with nobody behind it — and all staff would otherwise see is
    // "Name unavailable" with no reason for it.
    mockVerifyPrizeCode.mockResolvedValue({
      ...validCheck,
      winner: {
        ...validCheck.winner,
        accountClosed: true,
        firstName: null,
        lastName: null,
      },
    })

    await act(async () => {
      tree = create(<RedeemPrize />)
    })
    await type(tree, CODE)
    await press(tree, "Check code")

    const text = textOf(tree)
    expect(text).toContain("closed their account")
    expect(text).toContain("Name unavailable")
    // Still collectable — staff decide, they are just told.
    expect(buttonSaying(tree, "Mark as collected")).toBeDefined()
  })

  it("does not collect anything just by checking", async () => {
    // The whole reason this is two steps.
    await act(async () => {
      tree = create(<RedeemPrize />)
    })
    await type(tree, CODE)
    await press(tree, "Check code")

    expect(mockRedeemPrizeCode).not.toHaveBeenCalled()
  })

  it("collects only once staff confirm", async () => {
    await act(async () => {
      tree = create(<RedeemPrize />)
    })
    await type(tree, CODE)
    await press(tree, "Check code")
    await press(tree, "Mark as collected")

    expect(mockRedeemPrizeCode).toHaveBeenCalledWith(CODE)
    expect(textOf(tree)).toContain("Collected")
  })

  it("keeps saying what was handed over, and to whom", async () => {
    // Staff get interrupted between confirming and handing the thing over.
    // Once the check is cleared this panel is the only record left on screen.
    await act(async () => {
      tree = create(<RedeemPrize />)
    })
    await type(tree, CODE)
    await press(tree, "Check code")
    await press(tree, "Mark as collected")

    const text = textOf(tree)
    expect(text).toContain("A free tub of mochi")
    expect(text).toContain("Ana Ruiz")
  })

  it("says a prize was already collected, and does not offer to hand it over", async () => {
    // Read as a typo, staff retype it — and a second "invalid" would look like
    // a fresh code, which is how a prize gets handed over twice.
    mockVerifyPrizeCode.mockResolvedValue({
      valid: false,
      reason: "ALREADY_REDEEMED",
      message: "This prize was already collected on 2/11/2026, 2:14:00 pm.",
      winner: validCheck.winner,
    })

    await act(async () => {
      tree = create(<RedeemPrize />)
    })
    await type(tree, CODE)
    await press(tree, "Check code")

    expect(textOf(tree)).toContain("already collected")
    expect(buttonSaying(tree, "Mark as collected")).toBeUndefined()
  })

  it("surfaces an unknown code as a refusal, not a blank screen", async () => {
    mockVerifyPrizeCode.mockRejectedValue(
      new Error("That code does not match a prize."),
    )

    await act(async () => {
      tree = create(<RedeemPrize />)
    })
    await type(tree, CODE)
    await press(tree, "Check code")

    const text = textOf(tree)
    expect(text).toContain("does not match a prize")
    expect(text).toContain("Do not hand anything over")
  })

  it("clears the previous customer as soon as the code is edited", async () => {
    // Never leave one person's name sitting above a different half-typed code.
    await act(async () => {
      tree = create(<RedeemPrize />)
    })
    await type(tree, CODE)
    await press(tree, "Check code")
    expect(textOf(tree)).toContain("Ana Ruiz")

    await type(tree, "7K4M-Q92")

    expect(textOf(tree)).not.toContain("Ana Ruiz")
  })

  it("reports a prize another till collected first", async () => {
    // Two tablets racing the same code: the server refuses the second claim.
    mockRedeemPrizeCode.mockRejectedValue(
      new Error("This prize was already collected on 2/11/2026, 2:14:00 pm."),
    )

    await act(async () => {
      tree = create(<RedeemPrize />)
    })
    await type(tree, CODE)
    await press(tree, "Check code")
    await press(tree, "Mark as collected")

    const text = textOf(tree)
    expect(text).toContain("already collected")
    expect(text).not.toContain("Ana Ruiz")
  })

  it("starts on the code handed in from the winners screen", async () => {
    // How a customer who arrived without their phone gets served.
    mockSearchParams.code = "7K4MQ92X"

    await act(async () => {
      tree = create(<RedeemPrize />)
    })

    expect(tree.root.findByType(TextInput).props.value).toBe(CODE)
  })

  it("resets for the next customer", async () => {
    await act(async () => {
      tree = create(<RedeemPrize />)
    })
    await type(tree, CODE)
    await press(tree, "Check code")
    await press(tree, "Mark as collected")

    await press(tree, "Next customer")

    expect(tree.root.findByType(TextInput).props.value).toBe("")
    expect(textOf(tree)).not.toContain("Ana Ruiz")
  })
})
