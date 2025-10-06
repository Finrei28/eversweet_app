"use client"

import { formatCurrency, formatDate } from "@/lib/formatters"
import { Order } from "@/lib/types"
import { Ionicons } from "@expo/vector-icons"
import { Text, TouchableOpacity, View } from "react-native"
import { StatusBadge } from "./status-badge"

type OrderListItemProps = {
  order: Order
  onPress: () => void
}

export function OrderListItem({ order, onPress }: OrderListItemProps) {
  const hasCustomizations = order.desserts.some(
    (item) => item.customisations && item.customisations.length > 0
  )

  const totalItems = order.desserts.reduce(
    (total, item) => total + item.quantity,
    0
  )

  return (
    <TouchableOpacity
      className="bg-gray-50 rounded-lg p-3 mb-2 border border-gray-100"
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View className="flex-row justify-between items-center">
        <View>
          <Text className="font-medium">Order #{order.tempOrderId}</Text>
          <Text className="text-gray-500 text-sm">
            {formatDate(new Date(order.createdAt).toISOString())}
          </Text>
        </View>
        <StatusBadge status={order.status} />
      </View>

      <View className="flex-row justify-between items-center mt-2">
        <View className="flex-row items-center">
          <Text className="text-gray-600 mr-2">{totalItems} items</Text>
          {hasCustomizations && (
            <View className="bg-amber-100 rounded-full px-2 py-0.5">
              <Text className="text-amber-800 text-xs">Customised</Text>
            </View>
          )}
        </View>
        <View className="flex-row items-center">
          <Text className="font-medium mr-1">
            {formatCurrency(
              (order.priceInCents - order.discountedAmountInCents) / 100
            )}
          </Text>
          <Ionicons name="chevron-forward" size={16} color="#6B7280" />
        </View>
      </View>
    </TouchableOpacity>
  )
}
