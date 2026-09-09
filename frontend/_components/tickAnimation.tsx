import { useEffect, useRef } from "react"
import { Animated } from "react-native"
import Svg, { Path } from "react-native-svg"

// Module scope: created inside the component this was a brand new component
// type on every render, so React unmounted and remounted the path and the
// animation restarted from the beginning each time — during payment, where the
// parent re-renders often.
const AnimatedPath = Animated.createAnimatedComponent(Path)

export const TickAnimation = () => {
  const dashOffset = useRef(new Animated.Value(100)).current

  useEffect(() => {
    const animation = Animated.timing(dashOffset, {
      toValue: 0,
      duration: 1200,
      useNativeDriver: false, // required for SVG
    })

    animation.start()

    return () => animation.stop()
  }, [dashOffset])

  return (
    <Svg width={28} height={28} viewBox="0 0 24 24">
      <AnimatedPath
        d="M5 13l4 4L19 7"
        fill="none"
        stroke="#22C55E"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={100}
        strokeDashoffset={dashOffset}
      />
    </Svg>
  )
}
