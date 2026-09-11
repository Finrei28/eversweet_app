import { readdirSync, statSync } from "fs"
import { join, relative, sep } from "path"

/**
 * Expo Router requires every file under app/ at boot to build the route tree.
 * A test file there is therefore a screen, and referencing jest at module scope
 * crashes the app on launch with "Property 'jest' doesn't exist".
 *
 * Nothing else catches this: jest is perfectly happy to run a test from inside
 * app/, so the suite stayed green while the app would not start at all. Hence a
 * test about where the tests are.
 */
const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })

it("keeps test files out of app/, where they would be loaded as routes", () => {
  const appDir = join(__dirname, "..", "app")

  const offenders = filesUnder(appDir)
    .filter((path) => /\.(test|spec)\.[jt]sx?$/.test(path))
    .map((path) => relative(appDir, path).split(sep).join("/"))

  expect(offenders).toEqual([])
})
