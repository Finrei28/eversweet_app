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
import { formatCurrency, formatDate } from "@/lib/formatters"
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
    switch (status.toUpperCase()) {
      case "PICKED_UP":
        return "bg-green-100 text-green-800"
      case "CANCELLED":
        return "bg-red-100 text-red-800"
      default:
        return "bg-gray-100 text-gray-800"
    }
  }

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
        <View className="mt-6 mb-4 px-1">
          <Text className="text-2xl font-bold">Order History</Text>
        </View>

        {orders && orders.length > 0 ? (
          orders.map((order) => {
            const orderDate = new Date(order.createdAt).toISOString()
            const totalItems = order.desserts.reduce(
              (total, item) => total + item.quantity,
              0,
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
                        order.status,
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
                      {formatCurrency(
                        (order.priceInCents - order.discountedAmountInCents) /
                          100,
                      )}
                    </Text>
                  </View>
                </View>

                {/* Order Details (expandable) */}
                <TouchableOpacity
                  onPress={() =>
                    setSelectedOrder(
                      selectedOrder === order.id ? null : order.id,
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
                      {order.pickedUpAt
                        ? formatDate(new Date(order.pickedUpAt).toISOString())
                        : "N/A"}
                    </Text>
                    {/* Order Items */}
                    <Text className="font-medium mb-3">Items</Text>
                    {order.desserts.map((item, index) => {
                      const originalCustomisationPrice =
                        item.customisations.reduce(
                          (acc, c) =>
                            acc +
                            (c.quantity > 0
                              ? c.customisation.priceInCents * c.quantity
                              : 0),
                          0,
                        )
                      const originalPrice =
                        (item.priceInCents + originalCustomisationPrice) / 100

                      const customisationPriceInCents =
                        item.customisations.reduce(
                          (acc, c) =>
                            acc +
                            (c.quantity > 0
                              ? (c.customisation.priceInCents -
                                  c.discountedAmountInCents) *
                                c.quantity
                              : 0),
                          0,
                        )

                      const itemPriceAfterDiscount =
                        item.priceInCents - item.discountedAmountInCents

                      const finalPrice =
                        (item.priceInCents -
                          item.discountedAmountInCents +
                          customisationPriceInCents) /
                        100
                      return (
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
                                process.env.EXPO_PUBLIC_FILLER_IMAGE_URL,
                            }}
                            className="w-12 h-12 rounded-md mr-3"
                          />
                          <View className="flex-1 gap-1">
                            <View className="flex flex-row items-center justify-between">
                              <Text className="font-medium">
                                {item.dessert.name}{" "}
                                {item.offerId && `(Members Offer)`}
                              </Text>
                              <Text>
                                {formatCurrency(
                                  (item.discountedAmountInCents > 0
                                    ? itemPriceAfterDiscount
                                    : item.priceInCents) / 100,
                                )}
                              </Text>
                            </View>

                            {item.customisations.map((customisation) => {
                              const customisationPriceAfterDiscount =
                                (customisation.customisation.priceInCents -
                                  customisation.discountedAmountInCents) *
                                customisation.quantity
                              return (
                                <View
                                  key={customisation.id}
                                  className="flex flex-row items-center justify-between"
                                >
                                  <Text>{`${
                                    customisation.quantity === 0 ? `- ` : `+ `
                                  } ${customisation.customisation.name} ${
                                    customisation.quantity > 1
                                      ? `x${customisation.quantity}`
                                      : ``
                                  }`}</Text>
                                  {customisation.quantity > 0 && ( // only show price of customisation that customers want to add and not remove
                                    <Text className="text-sm text-muted-foreground">
                                      {formatCurrency(
                                        customisationPriceAfterDiscount / 100,
                                      )}
                                    </Text>
                                  )}
                                </View>
                              )
                            })}
                            <View className="flex flex-row items-center justify-between border-t border-gray-500 py-2">
                              <Text className="text-gray-500 text-sm">
                                Qty: {item.quantity}×{" "}
                                {item.discountedAmountInCents > 0 && (
                                  <Text className="text-gray-400 text-sm line-through">
                                    {formatCurrency(originalPrice)}{" "}
                                  </Text>
                                )}
                                {formatCurrency(finalPrice)}
                              </Text>
                              <Text className="font-medium">
                                {formatCurrency(item.quantity * finalPrice)}
                              </Text>
                            </View>
                          </View>
                        </View>
                      )
                    })}

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
              No past orders yet
            </Text>
            <TouchableOpacity
              onPress={() => router.replace("/menu")}
              className="mt-4 bg-primary py-2 px-4 rounded-lg"
            >
              <Text className="text-white font-medium">Start Ordering</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  )
}
