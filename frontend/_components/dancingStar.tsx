import React, { useEffect, useRef, useState } from "react"
import { Text, Animated, Easing } from "react-native"

export default function StarDance() {
  const anim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    // Loop forever between 0 → 1 → 0
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {
          toValue: 1,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 0,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start()
  }, [anim])

  // Interpolate 0 → 1 → 0 into smooth left-right translation
  const translateX = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [-1, 1],
  })

  // Bounce slightly up when switching sides
  const translateY = anim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, -10, 0],
  })

  // Add a little rotation for liveliness
  const rotate = anim.interpolate({
    inputRange: [0, 1],
    outputRange: ["-10deg", "10deg"],
  })

  return (
    <Animated.View
      style={{
        transform: [{ translateX }, { translateY }, { rotate }],
      }}
    >
      <Text className="text-xl text-center">⭐️</Text>
    </Animated.View>
  )
}
