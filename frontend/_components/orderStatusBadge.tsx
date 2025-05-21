import React, { useEffect, useRef } from "react"
import { Animated, StyleSheet, Text, View } from "react-native"

type StatusBadgeProps = {
  status: string
}

export const StatusBadge = ({ status }: StatusBadgeProps) => {
  // Create animated values
  const opacity = useRef(new Animated.Value(1)).current
  const scale = useRef(new Animated.Value(1)).current
  const animationRef = useRef<Animated.CompositeAnimation | null>(null)

  const getStatusColor = (status: string) => {
    switch (status) {
      case "MAKING":
        return {
          bg: "bg-amber-100",
          text: "text-amber-800",
          border: "border-amber-300",
          shadow: "#F59E0B", // Amber 500
        }
      case "PENDING":
        return {
          bg: "bg-blue-100",
          text: "text-blue-800",
          border: "border-blue-300",
          shadow: "#3B82F6", // Blue 500
        }
      case "ACCEPTED":
        return {
          bg: "bg-indigo-100",
          text: "text-indigo-800",
          border: "border-indigo-300",
          shadow: "#6366F1", // Indigo 500
        }
      case "READY":
        return {
          bg: "bg-green-100",
          text: "text-green-800",
          border: "border-green-300",
          shadow: "#10B981", // Green 500
        }
      case "DECLINED":
        return {
          bgColor: "bg-red-100",
          text: "text-red-800",
          border: "border-red-300",
          shadow: "#EF4444", // Red 500
        }
      default:
        return {
          bg: "bg-gray-100",
          text: "text-gray-800",
          border: "border-gray-300",
          shadow: "#6B7280", // Gray 500
        }
    }
  }

  // Start animation when component mounts
  useEffect(() => {
    // Only animate for MAKING status
    if (status === "MAKING") {
      // Create animation sequence
      const pulseAnimation = Animated.loop(
        Animated.parallel([
          Animated.sequence([
            Animated.timing(opacity, {
              toValue: 0.6,
              duration: 800,
              useNativeDriver: true,
            }),
            Animated.timing(opacity, {
              toValue: 1,
              duration: 800,
              useNativeDriver: true,
            }),
          ]),
          Animated.sequence([
            Animated.timing(scale, {
              toValue: 0.95,
              duration: 800,
              useNativeDriver: true,
            }),
            Animated.timing(scale, {
              toValue: 1,
              duration: 800,
              useNativeDriver: true,
            }),
          ]),
        ])
      )

      // Start animation and store reference
      animationRef.current = pulseAnimation
      pulseAnimation.start()
    }

    // Clean up animation on unmount
    return () => {
      if (animationRef.current) {
        animationRef.current.stop()
      }
    }
  }, [status, opacity, scale])

  const colors = getStatusColor(status)
  if (status === "MAKING") {
    return (
      <Animated.View
        style={[
          styles.animatedBadge,
          {
            opacity,
            transform: [{ scale }],
            shadowColor: colors.shadow,
          },
        ]}
      >
        <View
          className={`px-3 py-1 rounded-full ${colors.bg} ${colors.border} border`}
        >
          <Text className={`text-xs font-medium ${colors.text}`}>MAKING</Text>
        </View>
      </Animated.View>
    )
  }

  return (
    <View
      className={`px-3 py-1 rounded-full ${colors.bg} ${colors.border} border`}
    >
      <Text className={`text-xs font-medium ${colors.text}`}>{status}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  animatedBadge: {
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 5,
    elevation: 6, // For Android
    borderRadius: 20,
  },
})
