"use client"

import { formatCurrency, formatDate, getCollectionTime } from "@/lib/formatters"
import { Ionicons } from "@expo/vector-icons"

import { Order, OrderStatus } from "@/lib/types"
import { useRouter } from "expo-router"
import { Text, TouchableOpacity, View } from "react-native"
import { StatusBadge } from "./status-badge"

type OrderCardProps = {
  order: Order
  onPress: () => void
  onAccept?: () => void
  onDecline?: () => void
  onStatusChange?: (status: OrderStatus) => void
}

export function OrderCard({
  order,
  onPress,
  onAccept,
  onDecline,
  onStatusChange,
}: OrderCardProps) {
  const hasCustomizations = order.desserts.some(
    (item) => item.customisations && item.customisations.length > 0
  )
  const router = useRouter()

  // Status options for each current status
  const statusOptions: Record<string, OrderStatus[]> = {
    ACCEPTED: ["MAKING"],
    MAKING: ["READY"],
    READY: ["PICKED_UP"],
    PICKED_UP: [],
  }

  const nextStatus = statusOptions[order.status]?.[0]

  const bgColour =
    nextStatus === "MAKING"
      ? "bg-indigo-100"
      : nextStatus === "READY"
      ? "bg-purple-100"
      : nextStatus === "PICKED_UP"
      ? "bg-green-100"
      : "bg-indigo-100"
  const textColour =
    nextStatus === "MAKING"
      ? "text-indigo-600"
      : nextStatus === "READY"
      ? "text-purple-600"
      : nextStatus === "PICKED_UP"
      ? "text-green-600"
      : "text-indigo-600"

  const hexColour =
    nextStatus === "MAKING"
      ? "#4F46E5" // text-indigo-600
      : nextStatus === "READY"
      ? "#7C3AED" // text-purple-600
      : nextStatus === "PICKED_UP"
      ? "#16A34A" // text-green-600
      : "#4F46E5" // default: text-indigo-600

  return (
    <View className="bg-white rounded-lg shadow-sm overflow-hidden">
      {/* Order header */}
      <TouchableOpacity className="p-4" onPress={onPress} activeOpacity={0.7}>
        <View className="flex-row justify-between items-center">
          <View>
            <Text className="font-semibold text-lg">
              Order #{order.tempOrderId}
            </Text>
            <Text className="text-gray-500">
              {formatDate(new Date(order.createdAt).toISOString())}
            </Text>
            <Text className="text-gray-500">
              Desired pick up time:{" "}
              {getCollectionTime(new Date(order.pickUpTime))}
            </Text>
          </View>
          <StatusBadge status={order.status} />
        </View>

        {/* Order details */}
        <View className="flex-row justify-between items-center mt-3">
          <View>
            <Text className="text-gray-700">{`${order.customerFirstName} ${order.customerLastName}`}</Text>
            <Text className="text-gray-500">{order.desserts.length} items</Text>
          </View>
          <Text className="font-bold text-lg">
            {formatCurrency(order.priceInCents / 100)}
          </Text>
        </View>

        {/* Customization badge */}
        {hasCustomizations && (
          <View className="mt-3 bg-amber-50 px-3 py-2 rounded-lg border border-amber-200 flex-row items-center">
            <Ionicons name="alert-circle" size={18} color="#F59E0B" />
            <Text className="text-amber-800 ml-2 font-medium">
              Customised Order
            </Text>
          </View>
        )}
      </TouchableOpacity>

      {/* Action buttons */}
      <View className="flex-row border-t border-gray-100">
        {order.status === "PENDING" ? (
          <>
            {/* <TouchableOpacity
              className="flex-1 py-3 bg-red-300 items-center justify-center"
              onPress={onDecline}
            >
              <Text className="text-red-600 font-medium">Decline</Text>
            </TouchableOpacity> */}

            <TouchableOpacity
              className="flex-1 py-3 bg-green-300 items-center justify-center"
              onPress={onAccept}
            >
              <Text className="text-green-600 font-medium">Accept</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity
              className="flex-1 py-3 flex-row items-center justify-center"
              onPress={() => router.push(`/order-details/${order.id}`)}
            >
              <Ionicons name="eye-outline" size={18} color="#6366F1" />
              <Text className="text-indigo-600 font-medium ml-1">
                View Details
              </Text>
            </TouchableOpacity>

            {nextStatus && onStatusChange && (
              <TouchableOpacity
                className={`flex-1 py-3 flex-row items-center justify-center  ${bgColour}`}
                onPress={() => onStatusChange(nextStatus)}
              >
                <Ionicons
                  name={
                    nextStatus === "MAKING"
                      ? "restaurant-outline"
                      : nextStatus === "READY"
                      ? "checkmark-circle-outline"
                      : nextStatus === "PICKED_UP"
                      ? "archive-outline"
                      : "arrow-forward"
                  }
                  size={18}
                  color={hexColour}
                />
                <Text className={`${textColour} font-medium ml-1`}>
                  Mark as{" "}
                  {nextStatus.charAt(0) + nextStatus.slice(1).toLowerCase()}
                </Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
    </View>
  )
}
