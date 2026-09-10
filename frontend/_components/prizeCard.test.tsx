import {
  act,
  create,
  ReactTestInstance,
  ReactTestRenderer,
} from "react-test-renderer"
import { Prize } from "@/utils/types"

// The real icon set loads its font asynchronously and sets state when it lands,
// which arrives as an act() warning long after a test has finished.
jest.mock("@expo/vector-icons", () => ({
  MaterialCommunityIcons: "MaterialCommunityIcons",
}))

import { PrizeCard } from "./prizeCard"

const stringsIn = (node: ReactTestInstance | string): string[] =>
  typeof node === "string" ? [node] : node.children.flatMap(stringsIn)

const textOf = (tree: ReactTestRenderer) => stringsIn(tree.root).join(" | ")

const pressableSaying = (tree: ReactTestRenderer, label: string) =>
  tree.root
    .findAll((node) => typeof node.props?.onPress === "function")
    .filter((node) => stringsIn(node).some((text) => text.includes(label)))
    .sort((a, b) => stringsIn(a).join("").length - stringsIn(b).join("").length)[0]

const makePrize = (over: Partial<Prize> = {}): Prize => ({
  id: "p1",
  place: 2,
  month: 8,
  year: 2026,
  points: 640,
  reward: null,
  ...over,
})

const reward = (over: Partial<NonNullable<Prize["reward"]>> = {}) => ({
  title: "A free tub of mochi",
  description: "Any flavour",
  expiresAt: "2026-11-01T00:00:00.000Z",
  redeemedAt: null,
  code: "7K4M-Q92X",
  ...over,
})

const render = (prize: Prize, onShowCode = jest.fn()) => {
  let tree!: ReactTestRenderer
  act(() => {
    tree = create(<PrizeCard prize={prize} onShowCode={onShowCode} />)
  })
  return { tree, onShowCode }
}

describe("a prize the shop has not decided on yet", () => {
  const prize = makePrize()

  it("still says they placed, because that is news on its own", () => {
    const { tree } = render(prize)

    const text = textOf(tree)
    expect(text).toContain("2nd place")
    expect(text).toContain("being prepared")
  })

  it("offers no code, because none exists yet", () => {
    const { tree } = render(prize)

    expect(pressableSaying(tree, "Show collection code")).toBeUndefined()
  })
})

describe("a prize ready to collect", () => {
  const prize = makePrize({ reward: reward() })

  it("names the prize and its conditions", () => {
    const { tree } = render(prize)

    const text = textOf(tree)
    expect(text).toContain("A free tub of mochi")
    expect(text).toContain("Any flavour")
  })

  it("says when it has to be collected by", () => {
    const { tree } = render(prize)

    expect(textOf(tree)).toContain("Collect in store by")
  })

  it("hands the whole prize back when the code is asked for", () => {
    const { tree, onShowCode } = render(prize)

    act(() => {
      pressableSaying(tree, "Show collection code")!.props.onPress()
    })

    expect(onShowCode).toHaveBeenCalledWith(prize)
  })

  it("reads as one sentence to a screen reader", () => {
    const { tree } = render(prize)

    const labelled = tree.root.find(
      (node) => node.props?.accessible === true && !!node.props?.accessibilityLabel,
    )
    expect(labelled.props.accessibilityLabel).toBe(
      "You placed 2nd and won A free tub of mochi.",
    )
  })
})

describe("a prize already collected", () => {
  const prize = makePrize({
    reward: reward({ redeemedAt: "2026-10-04T02:00:00.000Z" }),
  })

  it("stops offering the code", () => {
    // The server has already withheld it; the card must not imply otherwise.
    const { tree } = render(prize)

    expect(pressableSaying(tree, "Show collection code")).toBeUndefined()
  })

  it("says when it was collected", () => {
    const { tree } = render(prize)

    const text = textOf(tree)
    expect(text).toContain("Collected on")
    expect(text).toContain("Enjoy")
  })

  it("tells a screen reader it is done", () => {
    const { tree } = render(prize)

    const labelled = tree.root.find(
      (node) => node.props?.accessible === true && !!node.props?.accessibilityLabel,
    )
    expect(labelled.props.accessibilityLabel).toContain("Already collected")
  })
})

describe("place wording", () => {
  it.each([
    [1, "1st place"],
    [2, "2nd place"],
    [3, "3rd place"],
  ])("renders place %i as %s", (place, expected) => {
    const { tree } = render(makePrize({ place, reward: reward() }))

    expect(textOf(tree)).toContain(expected)
  })
})
