"use client"

import { useState, useEffect } from "react"
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
  RefreshControl,
} from "react-native"
import { useRouter } from "expo-router"
import { Feather } from "@expo/vector-icons"
import CustomHeader from "@/_components/custom-header"
import BouncingLoader from "@/_components/loader"
import useFetch from "@/services/use_fetch"
import { getUserOrders } from "@/services/api"
import { formatDate } from "@/lib/formatters"
import { useAuth } from "@/store/authProvider"

export default function OrderHistory() {
  const router = useRouter()
  const { token, loading: loadingToken } = useAuth()
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null)

  const {
    data: orders,
    loading: ordersLoading,
    refetch: refetchOrders,
  } = useFetch(() => getUserOrders("PICKED_UP"))

  const [refreshing, setRefreshing] = useState(false)

  const onRefresh = async () => {
    setRefreshing(true)
    // Simulate network request or data refresh
    refetchOrders()
    setRefreshing(false)
  }

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case "PICKED_UP":
        return "bg-green-100 text-green-800"
      case "CANCELLED":
        return "bg-red-100 text-red-800"
      default:
        return "bg-gray-100 text-gray-800"
    }
  }

  // const handleReorder = (orderId: string) => {
  //   // Implement reorder functionality
  //   console.log(`Reordering items from order ${orderId}`)
  // }

  if (loadingToken || ordersLoading) {
    return (
      <View className="flex-1 bg-background">
        <CustomHeader />
        <View className="flex-1 items-center justify-center">
          <BouncingLoader />
        </View>
      </View>
    )
  }

  if (!token) {
    router.replace("/")
    return null
  }
  return (
    <View className="flex-1 bg-background">
      <CustomHeader />
      <ScrollView
        className="flex-1 px-4 mb-10"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={["#9Bd35A", "#689F38"]} // Customize the color of the refresh indicator
          />
        }
      >
        <View className="mt-6 mb-4">
          <Text className="text-2xl font-bold">Order History</Text>
        </View>

        {orders && orders.length > 0 ? (
          orders.map((order) => {
            const orderDate = new Date(order.createdAt).toISOString()
            const totalItems = order.desserts.reduce(
              (total, item) => total + item.quantity,
              0
            )
            return (
              <View
                key={order.id}
                className="bg-white rounded-xl shadow-sm mb-4 overflow-hidden"
              >
                {/* Order Header */}
                <View className="p-4 border-b border-gray-200">
                  <View className="flex-row justify-between items-center">
                    <View>
                      <Text className="text-gray-500 text-sm">
                        Order #{order.tempOrderId}
                      </Text>
                      <Text className="font-medium">
                        {formatDate(orderDate)}
                      </Text>
                    </View>
                    <View
                      className={`px-3 py-1 rounded-full ${getStatusColor(
                        order.status
                      )}`}
                    >
                      <Text className="text-xs font-medium">
                        {order.status}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Order Summary (always visible) */}
                <View className="p-4">
                  <View className="flex-row justify-between mb-2">
                    <Text className="text-gray-500">Items</Text>
                    <Text className="font-medium">{totalItems}</Text>
                  </View>
                  <View className="flex-row justify-between mb-2">
                    <Text className="text-gray-500">Total</Text>
                    <Text className="font-medium">
                      ${(order.priceInCents / 100).toFixed(2)}
                    </Text>
                  </View>
                </View>

                {/* Order Details (expandable) */}
                <TouchableOpacity
                  onPress={() =>
                    setSelectedOrder(
                      selectedOrder === order.id ? null : order.id
                    )
                  }
                  className="px-4 py-2 border-t border-gray-200 flex-row justify-between items-center"
                >
                  <Text className="text-primary font-medium">
                    {selectedOrder === order.id
                      ? "Hide Details"
                      : "View Details"}
                  </Text>
                  <Feather
                    name={
                      selectedOrder === order.id ? "chevron-up" : "chevron-down"
                    }
                    size={20}
                    color="#6B7280"
                  />
                </TouchableOpacity>

                {/* Expanded Order Details */}
                {selectedOrder === order.id && (
                  <View className="p-4 border-t border-gray-200">
                    <Text className="font-medium mb-3">
                      Picked up on{" "}
                      {formatDate(new Date(order.pickedUpAt).toISOString())}
                    </Text>
                    {/* Order Items */}
                    <Text className="font-medium mb-3">Items</Text>
                    {order.desserts.map((item, index) => (
                      <View
                        key={index}
                        className={`flex-row items-center py-2 ${
                          index < order.desserts.length - 1
                            ? "border-b border-gray-100"
                            : ""
                        }`}
                      >
                        <Image
                          source={{
                            uri:
                              item.dessert.imagePath ||
                              "https://via.placeholder.com/50",
                          }}
                          className="w-12 h-12 rounded-md mr-3"
                        />
                        <View className="flex-1 gap-1">
                          <Text className="font-medium">
                            {item.dessert.name}
                          </Text>
                          {item.customisations.map((customisation) => (
                            <Text key={customisation.id}>{`${
                              customisation.quantity === 0 ? `- ` : `+ `
                            } ${customisation.customisation.name} ${
                              customisation.quantity > 1
                                ? `x${customisation.quantity}`
                                : ``
                            }`}</Text>
                          ))}
                          <Text className="text-gray-500 text-sm">
                            Qty: {item.quantity} × $
                            {(item.dessert.priceInCents / 100).toFixed(2)}
                          </Text>
                        </View>
                        <Text className="font-medium">
                          $
                          {(
                            (item.quantity * item.dessert.priceInCents) /
                            100
                          ).toFixed(2)}
                        </Text>
                      </View>
                    ))}

                    {/* Payment Method */}
                    {/* <View className="mt-4">
                    <Text className="font-medium mb-2">Payment Method</Text>
                    <View className="flex-row items-center">
                      <FontAwesome
                        name={
                          `cc-${order.paymentMethod.type.toLowerCase()}` as keyof typeof FontAwesome.glyphMap
                        }
                        size={24}
                        color="#6B7280"
                      />
                      <Text className="ml-2 text-gray-700">
                        •••• {order.paymentMethod.lastFour}
                      </Text>
                    </View>
                  </View> */}

                    {/* Order Actions */}
                    {/* <View className="mt-6 flex-row justify-between">
                      <TouchableOpacity
                        onPress={() => handleReorder(order.id)}
                        className="bg-primary py-2 px-4 rounded-lg"
                      >
                        <Text className="text-white font-medium">Reorder</Text>
                      </TouchableOpacity>

                      {order.status !== "Cancelled" && (
                        <TouchableOpacity
                          onPress={() =>
                            router.push(`/track-order/${order.id}`)
                          }
                          className="border border-gray-300 py-2 px-4 rounded-lg"
                        >
                          <Text className="font-medium">Track Order</Text>
                        </TouchableOpacity>
                      )}
                    </View> */}
                  </View>
                )}
              </View>
            )
          })
        ) : (
          <View className="bg-white rounded-xl shadow-sm p-6 items-center mb-6">
            <Feather name="shopping-bag" size={48} color="#D1D5DB" />
            <Text className="mt-2 text-gray-500 text-center">
              No orders yet
            </Text>
            <TouchableOpacity
              onPress={() => router.push("/menu")}
              className="mt-4 bg-primary py-2 px-4 rounded-lg"
            >
              <Text className="text-white font-medium">Start Shopping</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  )
}
