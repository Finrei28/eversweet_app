import { useEffect, useRef } from "react"
import { View } from "react-native"
import { usePathname, useSegments } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Toast, { ToastConfig } from "react-native-toast-message"
import { TAB_BAR_HEIGHT } from "@/lib/layout"

/** Space between a toast and whatever it sits on: the tab bar, the safe area or the keyboard. */
const GAP = 10

/**
 * How long a toast has been up before a navigation counts as leaving it behind. Sign-in,
 * sign-up and a password reset show their toast and then navigate at once, and the toast
 * is about the screen they land on ("Welcome back"); anything older belongs to the screen
 * being left.
 */
const NAVIGATION_GRACE_MS = 1000

/**
 * The app's one Toast, placed for the screen it is over.
 *
 * Every call site used to pass `bottomOffset: 90`, which clears the tab bar and nothing
 * else, so on a screen without one the toast floated a tab bar's height above the bottom.
 * The offset is now measured from a container whose bottom edge is the tab bar or the
 * safe area, and it follows the route, so a toast shown just before a navigation moves
 * with it. A call site that passes `bottomOffset` puts the old problem back.
 *
 * It is also hidden on navigation. A toast with `autoHide: false` (checkout's card
 * error) otherwise followed the customer to every screen until swiped away. This relies
 * on the `onShow`/`onHide` defaults below, so call sites must not pass their own.
 */
export default function ToastHost({ config }: { config: ToastConfig }) {
  const onTabs = useSegments()[0] === "(tabs)"
  const pathname = usePathname()
  const insets = useSafeAreaInsets()
  const shownAt = useRef<number | null>(null)

  const base = onTabs ? TAB_BAR_HEIGHT : insets.bottom

  useEffect(() => {
    const at = shownAt.current
    if (at !== null && Date.now() - at > NAVIGATION_GRACE_MS) Toast.hide()
  }, [pathname])

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: base,
        pointerEvents: "box-none",
      }}
    >
      <Toast
        config={config}
        position="bottom"
        bottomOffset={GAP}
        // The keyboard is measured from the bottom of the screen, not of this
        // container, and covers the tab bar and the safe area when it is up.
        keyboardOffset={GAP - base}
        onShow={() => {
          shownAt.current = Date.now()
        }}
        onHide={() => {
          shownAt.current = null
        }}
      />
    </View>
  )
}
