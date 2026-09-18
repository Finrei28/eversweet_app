jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)

import { useAppUpdateStore } from "@/store/appUpdate"

const reset = () =>
  useAppUpdateStore.setState({
    status: "ok",
    recommendedBuild: null,
    dismissedBuild: null,
    hydrated: true,
  })

beforeEach(reset)

describe("the app update store", () => {
  it("keeps a dismissal against the build it was made for", () => {
    const { noteRecommended, dismiss } = useAppUpdateStore.getState()

    noteRecommended(120)
    dismiss()

    expect(useAppUpdateStore.getState().dismissedBuild).toBe(120)
  })

  it("asks again once a newer build is recommended", () => {
    const { noteRecommended, dismiss } = useAppUpdateStore.getState()

    noteRecommended(120)
    dismiss()
    noteRecommended(130)

    const { recommendedBuild, dismissedBuild } = useAppUpdateStore.getState()
    expect(recommendedBuild).toBe(130)
    expect(recommendedBuild).not.toBe(dismissedBuild)
  })

  it("lifts the wall when the server stops refusing the build", () => {
    // Not one-way on purpose. A minimum set too high is undone with an
    // environment change, and by then nothing in the app is fetching to notice
    // — the update screen's own re-check is what lands here.
    const { noteRequired, noteUpToDate } = useAppUpdateStore.getState()

    noteRequired()
    expect(useAppUpdateStore.getState().status).toBe("required")

    noteUpToDate()
    expect(useAppUpdateStore.getState().status).toBe("ok")
  })

  it("forgets a recommendation it had when the build is refused outright", () => {
    const { noteRecommended, noteRequired } = useAppUpdateStore.getState()

    noteRecommended(120)
    noteRequired()

    expect(useAppUpdateStore.getState().recommendedBuild).toBeNull()
  })

  it("never remembers that an update was required", () => {
    // Persisting it would block the app at cold start before the server had
    // said anything — including with no connection, where carrying on as normal
    // is the right answer.
    const partialize = useAppUpdateStore.persist.getOptions().partialize!

    expect(
      partialize({
        status: "required",
        recommendedBuild: 130,
        dismissedBuild: 120,
        hydrated: true,
      } as Parameters<typeof partialize>[0]),
    ).toEqual({ dismissedBuild: 120 })
  })

  // persist wraps setState so that any set writes the whole partialized state
  // back to AsyncStorage, changed or not. noteUpToDate runs on every API
  // response, so a set here would be a native-bridge write per request.
  it("does not touch the state when the server says nothing new", () => {
    const before = useAppUpdateStore.getState()

    before.noteUpToDate()

    expect(useAppUpdateStore.getState()).toBe(before)
  })

  it("does not touch the state when the same build is recommended twice", () => {
    useAppUpdateStore.getState().noteRecommended(120)
    const before = useAppUpdateStore.getState()

    before.noteRecommended(120)

    expect(useAppUpdateStore.getState()).toBe(before)
  })

  it("does not touch the state when the build is refused again", () => {
    useAppUpdateStore.getState().noteRequired()
    const before = useAppUpdateStore.getState()

    before.noteRequired()

    expect(useAppUpdateStore.getState()).toBe(before)
  })

  // zustand only sets hasHydrated() on the success path, and never calls the
  // finish listeners when the read throws — so a blocked or corrupt store would
  // otherwise withhold every nudge for the rest of the session.
  it("counts itself hydrated even when storage could not be read", async () => {
    const onRehydrate = useAppUpdateStore.persist.getOptions()
      .onRehydrateStorage!
    // zustand hands back the callback it will invoke once the read settles.
    const finished = onRehydrate(useAppUpdateStore.getState()) as (
      state?: unknown,
      error?: unknown,
    ) => void

    useAppUpdateStore.setState({ hydrated: false })
    finished(undefined, new Error("denied"))

    expect(useAppUpdateStore.getState().hydrated).toBe(true)
  })
})
