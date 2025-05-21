"use client"

import { formatDate } from "@/lib/formatters"
import { Ionicons } from "@expo/vector-icons"

import { StyleSheet, Text, TouchableOpacity, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

type DashboardHeaderProps = {
  title: string
  showDate?: boolean
  onBackPress?: () => void
}

export function DashboardHeader({
  title,
  showDate = false,
  onBackPress,
}: DashboardHeaderProps) {
  const insets = useSafeAreaInsets()

  return (
    <View
      style={[styles.container, { paddingTop: Math.max(insets.top, 16) }]}
      className="bg-white border-b border-gray-200 px-4 pb-4"
    >
      <View className="flex-row items-center">
        {onBackPress && (
          <TouchableOpacity onPress={onBackPress} className="mr-2">
            <Ionicons name="arrow-back" size={24} color="#000" />
          </TouchableOpacity>
        )}
        <Text className="text-2xl font-bold">{title}</Text>
      </View>

      {showDate && (
        <Text className="text-gray-500 mt-1">
          {formatDate(new Date().toISOString())}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    zIndex: 10,
  },
})
