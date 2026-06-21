"use client"

import newOrderServices from "@/services/newOrders-service"
import { Ionicons } from "@expo/vector-icons"
import { Text, View } from "react-native"

export function OrderQueueIndicator() {
  // If there's nothing in the queue and no current alert, don't show anything
  if (newOrderServices.getQueueLength() === 0) {
    return null
  }

  // Calculate total pending alerts (queue + current)
  const totalAlerts = newOrderServices.getQueueLength()

  return (
    <View className="absolute top-2 right-2 bg-red-500 px-3 py-1 rounded-full flex-row items-center">
      <Ionicons name="notifications" size={16} color="white" />
      <Text className="text-white font-medium ml-1">
        {totalAlerts} order{totalAlerts !== 1 ? "s" : ""} waiting
      </Text>
    </View>
  )
}
