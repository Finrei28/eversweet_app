import React, { useRef, useEffect } from "react"
import { View, Animated, Easing, StyleSheet } from "react-native"

const BouncingLoader = () => {
  const dot1 = useRef(new Animated.Value(0)).current
  const dot2 = useRef(new Animated.Value(0)).current
  const dot3 = useRef(new Animated.Value(0)).current

  const bounceDot = (dot: Animated.Value) => {
    return Animated.sequence([
      Animated.timing(dot, {
        toValue: -10,
        duration: 200,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(dot, {
        toValue: 0,
        duration: 200,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    ])
  }

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([bounceDot(dot1), bounceDot(dot2), bounceDot(dot3)])
    )

    loop.start()

    // This component is the loading state on almost every screen, so without a
    // stop here each visit left a running loop behind and they accumulated for
    // the rest of the session.
    return () => loop.stop()
  }, [])

  return (
    <View style={styles.container}>
      <Animated.View
        style={[styles.dot, { transform: [{ translateY: dot1 }] }]}
      />
      <Animated.View
        style={[styles.dot, { transform: [{ translateY: dot2 }] }]}
      />
      <Animated.View
        style={[styles.dot, { transform: [{ translateY: dot3 }] }]}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#e6aa6b",
  },
})

export default BouncingLoader
