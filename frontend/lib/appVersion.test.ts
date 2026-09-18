/**
 * expo-application reads constants out of the native binary, which does not
 * exist under jest. Each case loads the module fresh, because the headers are
 * worked out once when it is imported.
 */
const headersWith = (nativeBuildVersion: string | null) => {
  let headers: Record<string, string> = {}

  jest.isolateModules(() => {
    jest.doMock("expo-application", () => ({
      nativeBuildVersion,
      nativeApplicationVersion: "1.1.0",
    }))
    headers = require("./appVersion").APP_VERSION_HEADERS
  })

  return headers
}

describe("the headers a build sends about itself", () => {
  it("tells the server which build it is", () => {
    expect(headersWith("114")).toEqual({
      "X-App-Build": "114",
      "X-App-Platform": "ios",
    })
  })

  // Web has no store to be sent to, and nothing to read a build number from.
  // The server treats a request with no build header as "not the customer app"
  // and lets it through, so both sides fail in the same direction.
  it("says nothing when it cannot read its own build number", () => {
    expect(headersWith(null)).toEqual({})
  })
})
