"use client"

import { formatCurrency, formatDate } from "@/lib/formatters"
import { Order } from "@/lib/types"
import { Ionicons } from "@expo/vector-icons"
import { Text, TouchableOpacity, View } from "react-native"

type PastOrderCardProps = {
  order: Order
  onPress: () => void
}

export function PastOrderCard({ order, onPress }: PastOrderCardProps) {
  return (
    <TouchableOpacity
      className="bg-white rounded-lg p-4 shadow-sm"
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View className="flex-row justify-between items-center">
        <View>
          <Text className="font-semibold text-lg">
            Order #{order.tempOrderId}
          </Text>
          <Text className="text-gray-500">
            {formatDate(new Date(order.createdAt).toISOString())}
          </Text>
        </View>

        <View className="px-3 py-1 bg-green-100 rounded-full">
          <Text className="text-green-800 text-xs font-medium">Picked up</Text>
        </View>
      </View>

      <View className="flex-row justify-between items-center mt-3">
        <View>
          <Text className="text-gray-700">{`${order.customerFirstName} ${order.customerLastName}`}</Text>
          <Text className="text-gray-500">{order.desserts.length} items</Text>
        </View>
        <Text className="font-bold text-lg">
          {formatCurrency(order.priceInCents / 100)}
        </Text>
      </View>
      {order.pickedUpAt && (
        <View className="flex-row mt-3 items-center">
          <Ionicons name="time-outline" size={16} color="#6B7280" />
          <Text className="text-gray-500 ml-1 flex-shrink">
            Picked up at {formatDate(new Date(order.pickedUpAt).toISOString())}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  )
}
