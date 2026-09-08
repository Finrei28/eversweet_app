import React from "react"
import Animated, {
  SharedValue,
  useAnimatedStyle,
} from "react-native-reanimated"

const ACTIVE = "#F59E0B"
const INACTIVE = "#D1D5DB"

/**
 * Reads the carousel's progress on the UI thread.
 *
 * The dots were previously driven by React state written from the carousel's
 * per-frame progress callback, so every frame of every swipe crossed back into
 * JS to call setState on a screen that also holds the offer carousel and a
 * column of full-width category images.
 */
export const CarouselDot = React.memo(
  ({ index, progress }: { index: number; progress: SharedValue<number> }) => {
    const style = useAnimatedStyle(() => ({
      backgroundColor: Math.round(progress.value) === index ? ACTIVE : INACTIVE,
    }))

    return (
      <Animated.View
        style={[
          { width: 10, height: 10, borderRadius: 5, marginHorizontal: 4 },
          style,
        ]}
      />
    )
  },
)

CarouselDot.displayName = "CarouselDot"
