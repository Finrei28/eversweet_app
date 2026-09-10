import {
  act,
  create,
  ReactTestInstance,
  ReactTestRenderer,
} from "react-test-renderer"
import { Prize } from "@/utils/types"

jest.mock("@expo/vector-icons", () => ({
  MaterialCommunityIcons: "MaterialCommunityIcons",
}))

import { PrizeCodeModal } from "./prizeCodeModal"

const stringsIn = (node: ReactTestInstance | string): string[] =>
  typeof node === "string" ? [node] : node.children.flatMap(stringsIn)

const textOf = (tree: ReactTestRenderer) => stringsIn(tree.root).join(" | ")

const CODE = "7K4M-Q92X"

const makePrize = (
  rewardOver: Partial<NonNullable<Prize["reward"]>> = {},
): Prize => ({
  id: "p1",
  place: 1,
  month: 8,
  year: 2026,
  points: 900,
  reward: {
    title: "A free tub of mochi",
    description: "Any flavour",
    expiresAt: "2026-11-01T00:00:00.000Z",
    redeemedAt: null,
    code: CODE,
    ...rewardOver,
  },
})

const render = (prize: Prize | null, visible = true) => {
  const onClose = jest.fn()
  let tree!: ReactTestRenderer
  act(() => {
    tree = create(
      <PrizeCodeModal prize={prize} visible={visible} onClose={onClose} />,
    )
  })
  return { tree, onClose }
}

describe("showing a collection code", () => {
  it("shows the code exactly as the server grouped it", () => {
    // Staff read this aloud and type it into a tablet. Regrouping or
    // reformatting it here would put the two out of step.
    const { tree } = render(makePrize())

    expect(textOf(tree)).toContain(CODE)
  })

  it("shows what the code is for, so nobody has to remember", () => {
    const { tree } = render(makePrize())

    const text = textOf(tree)
    expect(text).toContain("A free tub of mochi")
    expect(text).toContain("Show this to our staff")
  })

  it("says when it expires", () => {
    const { tree } = render(makePrize())

    expect(textOf(tree)).toContain("Collect in store by")
  })

  it("spells the code out one character at a time for a screen reader", () => {
    // Read as a word this is meaningless noise, and the characters that survive
    // being spoken are exactly what the alphabet was chosen for.
    const { tree } = render(makePrize())

    const spelled = tree.root.find(
      (node) =>
        typeof node.props?.accessibilityLabel === "string" &&
        node.props.accessibilityLabel.startsWith("Your code is"),
    )

    expect(spelled.props.accessibilityLabel).toBe(
      "Your code is 7, K, 4, M, Q, 9, 2, X",
    )
  })

  it("closes when done", () => {
    const { tree, onClose } = render(makePrize())

    act(() => {
      tree.root
        .findAll((node) => typeof node.props?.onPress === "function")
        .filter((node) => stringsIn(node).some((t) => t.includes("Done")))
        .sort(
          (a, b) => stringsIn(a).join("").length - stringsIn(b).join("").length,
        )[0]
        .props.onPress()
    })

    expect(onClose).toHaveBeenCalled()
  })
})

describe("when there is no code to show", () => {
  // The server withholds the code once a prize expires or is collected, so the
  // modal has to cope with a prize that has a reward but no code — and must not
  // render an empty box that looks like a code failed to load.
  it("renders nothing for a collected prize", () => {
    const { tree } = render(makePrize({ code: null, redeemedAt: "2026-10-04" }))

    expect(tree.toJSON()).toBeNull()
  })

  it("renders nothing when no prize is selected", () => {
    const { tree } = render(null)

    expect(tree.toJSON()).toBeNull()
  })

  it("renders nothing when the prize has no reward yet", () => {
    const { tree } = render({ ...makePrize(), reward: null })

    expect(tree.toJSON()).toBeNull()
  })
})
