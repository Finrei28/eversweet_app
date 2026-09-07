// TEMPORARY — lets the app bundle for web so a component can be previewed in a
// browser. Delete alongside app/__preview.tsx.
//
// `react-native-ble-plx` has no web implementation, and the real service builds
// a BLE client in its constructor, so importing it at all crashes the web
// bundle. Metro picks this file for web only; native builds are untouched.
//
// Nothing is re-exported from the real module on purpose: `./thermal-printer`
// resolves back to this file on web, and the types are resolved by TypeScript
// from the `.ts` file regardless.

const unavailable = async () => ({
  success: false,
  message: "Bluetooth printing is not available on web",
})

/**
 * Answers every method with the same no-op. There is no printer behind a
 * browser tab, and nothing being previewed here prints.
 */
const thermalPrinter = new Proxy(
  {},
  {
    get: () => unavailable,
  },
)

export default thermalPrinter
