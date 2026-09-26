import { useCallback, useRef } from "react"
import type { LayoutChangeEvent, ScrollView } from "react-native"

/**
 * How much of the bar to leave showing before the chosen pill, so the one before it peeks in
 * and the bar still reads as something to scroll.
 */
const LEAD_IN = 16

/**
 * Scrolls the Menu and Rewards category bars to a category, by where its pill actually is.
 *
 * Both tabs used to work the offset out as `index * 130`, `* 145`, `* 160` and so on - numbers
 * tuned by eye for the categories the shop had then. The categories are the shop's to add and
 * rename, and a longer name or one more of them sent the bar somewhere else. Each pill reports
 * its own position as it lays out, so whatever the names, the bar lands on the pill.
 *
 * A category asked for before its pill has laid out (the first render of a tab) is held and
 * scrolled to the moment that pill reports in.
 *
 * Everything returned is stable, so effects can list it.
 */
export function useCategoryBarScroll() {
  const scrollViewRef = useRef<ScrollView>(null)
  const pillOffsets = useRef(new Map<string, number>())
  const waitingFor = useRef<string | null>(null)

  const scrollToCategory = useCallback((id: string) => {
    const x = pillOffsets.current.get(id)
    if (x === undefined || !scrollViewRef.current) {
      waitingFor.current = id
      return
    }

    waitingFor.current = null
    scrollViewRef.current.scrollTo({ x: Math.max(0, x - LEAD_IN), animated: true })
  }, [])

  const onPillLayout = useCallback(
    (id: string) => (event: LayoutChangeEvent) => {
      pillOffsets.current.set(id, event.nativeEvent.layout.x)
      if (waitingFor.current === id) scrollToCategory(id)
    },
    [scrollToCategory],
  )

  return { scrollViewRef, scrollToCategory, onPillLayout }
}
