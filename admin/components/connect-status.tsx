"use client"

import { useSocket } from "@/providers/socket-provider"
import { Ionicons } from "@expo/vector-icons"
import { Text, View } from "react-native"

export function ConnectionStatus() {
  const { isConnected } = useSocket()

  if (isConnected) {
    return null // Don't show anything when connected
  }

  return (
    <View className="absolute top-2 left-2 bg-red-500 px-3 py-1 rounded-full flex-row items-center">
      <Ionicons name="cloud-offline" size={16} color="white" />
      <Text className="text-white font-medium ml-1">Offline</Text>
    </View>
  )
}
