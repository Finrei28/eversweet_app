import {
  act,
  create,
  ReactTestInstance,
  ReactTestRenderer,
} from "react-test-renderer"

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)

import { Linking } from "react-native"
import UpdateNudgeModal from "./updateNudgeModal"
import { useAppUpdateStore } from "@/store/appUpdate"

const stringsIn = (node: ReactTestInstance | string): string[] =>
  typeof node === "string" ? [node] : node.children.flatMap(stringsIn)

const pressableSaying = (tree: ReactTestRenderer, label: string) =>
  tree.root
    .findAll((node) => typeof node.props?.onPress === "function")
    .filter((node) => stringsIn(node).some((text) => text.includes(label)))
    .sort(
      (a, b) => stringsIn(a).join("").length - stringsIn(b).join("").length,
    )[0]

const render = () => {
  const onClose = jest.fn()
  let tree!: ReactTestRenderer
  act(() => {
    tree = create(<UpdateNudgeModal onClose={onClose} />)
  })
  return { tree, onClose }
}

let openURL: jest.SpiedFunction<typeof Linking.openURL>

beforeEach(() => {
  openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true)
  useAppUpdateStore.setState({
    status: "recommended",
    recommendedBuild: 120,
    dismissedBuild: null,
  })
})

afterEach(() => {
  openURL.mockRestore()
})

describe("the update nudge", () => {
  it("remembers the build the customer said no to", () => {
    // Kept against the build rather than as a plain flag, so turning this
    // release down does not silence the next one.
    const { tree, onClose } = render()

    act(() => {
      pressableSaying(tree, "Not now").props.onPress()
    })

    expect(useAppUpdateStore.getState().dismissedBuild).toBe(120)
    expect(onClose).toHaveBeenCalled()
  })

  it("opens the store and gets out of the way", () => {
    const { tree, onClose } = render()

    act(() => {
      pressableSaying(tree, "Update").props.onPress()
    })

    expect(openURL).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalled()
  })

  it("does not record a dismissal for someone who went to update", () => {
    const { tree } = render()

    act(() => {
      pressableSaying(tree, "Update").props.onPress()
    })

    expect(useAppUpdateStore.getState().dismissedBuild).toBeNull()
  })
})
