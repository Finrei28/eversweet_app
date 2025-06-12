import BouncingLoader from "@/_components/loader"
import { StatusBadge } from "@/_components/orderStatusBadge"
import PageHeader from "@/_components/pageheader"
import { formatDate, getCollectionTime } from "@/lib/formatters"
import { getUserOrders } from "@/services/api"
import useFetch from "@/services/use_fetch"
import { useAuth } from "@/store/authProvider"
import { Order } from "@/utils/types"
import { Feather } from "@expo/vector-icons"
import { useFocusEffect, useRouter } from "expo-router"
import { useCallback, useRef, useState } from "react"
import {
  Image,
  Platform,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native"

export default function Orders() {
  const router = useRouter()
  const { token, loading } = useAuth()
  const [refreshing, setRefreshing] = useState(false)
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null)

  // Use our custom animation hook

  const {
    data: orders,
    loading: ordersLoading,
    error: ordersError,
    refetch: refetchOrders,
  } = useFetch(() => getUserOrders("PENDING")) // Gets pending and completed orders from backend

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    refetchOrders()
    setRefreshing(false)
  }, [refetchOrders])

  // Poll for updates every 30 seconds for pending orders
  useFocusEffect(
    useCallback(() => {
      if (!token) return

      refetchOrders()
    }, [token, refetchOrders])
  )

  const formatPickupTime = (pickupTime: string | null) => {
    if (!pickupTime) return "As soon as possible"
    if (pickupTime === "now") return "As soon as possible"

    try {
      return getCollectionTime(new Date(pickupTime))
    } catch (e) {
      return pickupTime
    }
  }

  const pendingOrders =
    orders?.filter((order) => order.status !== "READY") || []
  const completedOrders =
    orders?.filter((order) => order.status === "READY") || []

  if (loading || ordersLoading) {
    return (
      <View className="flex-1 bg-background">
        <PageHeader />
        <View
          className={`flex-1 items-center justify-center ${
            Platform.OS === "ios" ? "mt-32" : "mt-24"
          }`}
        >
          <BouncingLoader />
        </View>
      </View>
    )
  }

  if (!token) {
    return (
      <View className="flex-1 bg-background">
        <PageHeader />
        <View
          className={`flex-1 justify-center items-center ${
            Platform.OS === "ios" ? "mt-32" : "mt-24"
          }`}
        >
          <Text className="text-xl font-bold text-center px-4">
            Sign in to view your orders
          </Text>
          <TouchableOpacity
            onPress={() => {
              router.push({
                pathname: "/signin",
                params: { redirectTo: "/rewards" },
              })
            }}
            className="bg-primary p-3 rounded-lg w-1/3 items-center mt-5"
          >
            <Text className="text-white text-xl">Sign in</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  if (ordersError) {
    return (
      <View className="flex-1 bg-background">
        <PageHeader />
        <View
          className={`flex-1 items-center justify-center px-4 ${
            Platform.OS === "ios" ? "mt-32" : "mt-24"
          }`}
        >
          <Feather name="alert-circle" size={64} color="#EF4444" />
          <Text className="mt-4 text-xl text-center text-gray-700">
            Something went wrong
          </Text>
          <Text className="mt-2 text-center text-gray-500">
            We couldn't load your orders. Please try again.
          </Text>
          <TouchableOpacity
            onPress={onRefresh}
            className="mt-6 bg-primary py-3 px-6 rounded-lg"
          >
            <Text className="text-white font-medium">Try Again</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  if (!orders || orders.length === 0) {
    return (
      <View className="flex-1 bg-background">
        <PageHeader />
        <ScrollView
          className={`flex-1 px-4 ${Platform.OS === "ios" ? "mt-32" : "mt-24"}`}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          contentContainerStyle={{
            alignItems: "center",
            justifyContent: "center",
            flex: 1,
          }}
        >
          <Feather name="shopping-bag" size={64} color="#D1D5DB" />
          <Text className="mt-4 text-xl text-center text-gray-500">
            You don't have any orders yet
          </Text>
          <TouchableOpacity
            onPress={() => router.push("/menu")}
            className="mt-6 bg-primary py-3 px-6 rounded-lg"
          >
            <Text className="text-white font-medium">Start Shopping</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    )
  }

  return (
    <View className="flex-1 bg-background">
      <PageHeader />
      <ScrollView
        className={`flex-1 px-4 ${Platform.OS === "ios" ? "mt-32" : "mt-24"}`}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View className="flex-row justify-between items-center mt-6 mb-4">
          <Text className="text-2xl font-bold">Your Orders</Text>
          <TouchableOpacity
            onPress={() => router.push("/order-history")}
            className="flex-row items-center"
          >
            <Text className="text-primary mr-1">History</Text>
            <Feather name="chevron-right" size={18} color="#6B7280" />
          </TouchableOpacity>
        </View>

        {/* Completed Orders Section */}
        {completedOrders.length > 0 && (
          <View className="mb-6">
            <Text className="text-lg font-semibold mb-3">Completed Orders</Text>
            {completedOrders.map((order) => {
              const orderDate = new Date(order.createdAt)
              const pickUpTime = new Date(order.pickUpTime)
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
                          {formatDate(orderDate.toISOString())}
                        </Text>
                      </View>
                      <StatusBadge status={order.status} />
                    </View>
                  </View>

                  {/* Order Summary */}
                  <View className="p-4">
                    <View className="flex-row justify-between mb-2">
                      <Text className="text-gray-500">Items</Text>
                      <Text className="font-medium">
                        {order.desserts.length}
                      </Text>
                    </View>
                    <View className="flex-row justify-between mb-2">
                      <Text className="text-gray-500">Total</Text>
                      <Text className="font-medium">
                        ${(order.priceInCents / 100).toFixed(2)}
                      </Text>
                    </View>
                    <View className="flex-row justify-between mb-2">
                      <Text className="text-gray-500">
                        Estimated pick up time
                      </Text>
                      <Text className="font-medium">
                        {formatPickupTime(pickUpTime.toISOString())}
                      </Text>
                    </View>
                  </View>

                  {/* Order Details Toggle */}
                  <TouchableOpacity
                    onPress={() =>
                      setExpandedOrderId(
                        expandedOrderId === order.id ? null : order.id
                      )
                    }
                    className="px-4 py-2 border-t border-gray-200 flex-row justify-between items-center"
                  >
                    <Text className="text-primary font-medium">
                      {expandedOrderId === order.id
                        ? "Hide Details"
                        : "View Details"}
                    </Text>
                    <Feather
                      name={
                        expandedOrderId === order.id
                          ? "chevron-up"
                          : "chevron-down"
                      }
                      size={20}
                      color="#6B7280"
                    />
                  </TouchableOpacity>

                  {/* Expanded Order Details */}
                  {expandedOrderId === order.id && (
                    <View className="p-4 border-t border-gray-200">
                      <Text className="font-medium mb-3">Items</Text>
                      {order.desserts.map((item, index) => {
                        const itemTotalCostInCents =
                          item.customisations.reduce(
                            (total, customisationItem) => {
                              return (
                                total +
                                customisationItem.customisation.priceInCents *
                                  customisationItem.quantity
                              )
                            },
                            0
                          ) + item.dessert.priceInCents
                        return (
                          <View
                            key={item.id}
                            className={`flex-row items-center py-2 ${
                              index < order.desserts.length - 1
                                ? "border-b border-gray-100"
                                : ""
                            }`}
                          >
                            <View className="w-14 h-14 rounded-md mr-3 overflow-hidden">
                              <Image
                                source={{ uri: item.dessert.imagePath }}
                                style={{ width: "100%", height: "100%" }} // 8 * 4 = 32
                                resizeMode="cover"
                              />
                            </View>
                            <View className="flex-1">
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
                                {(itemTotalCostInCents / 100).toFixed(2)}
                              </Text>
                            </View>
                            <Text className="font-medium">
                              $
                              {(
                                (item.quantity * itemTotalCostInCents) /
                                100
                              ).toFixed(2)}
                            </Text>
                          </View>
                        )
                      })}
                    </View>
                  )}
                </View>
              )
            })}
          </View>
        )}

        {/* Pending Orders Section */}
        {pendingOrders.length > 0 && (
          <View className="mb-6">
            <Text className="text-lg font-semibold mb-3">Pending Orders</Text>
            {pendingOrders.map((order) => {
              const orderDate = new Date(order.createdAt)
              const pickUpTime = new Date(order.pickUpTime)
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
                          {formatDate(orderDate.toISOString())}
                        </Text>
                      </View>
                      <StatusBadge status={order.status} />
                    </View>
                  </View>

                  {/* Order Summary */}
                  <View className="p-4">
                    <View className="flex-row justify-between mb-2">
                      <Text className="text-gray-500">Items</Text>
                      <Text className="font-medium">
                        {order.desserts.length}
                      </Text>
                    </View>
                    <View className="flex-row justify-between mb-2">
                      <Text className="text-gray-500">Total</Text>
                      <Text className="font-medium">
                        ${(order.priceInCents / 100).toFixed(2)}
                      </Text>
                    </View>
                    <View className="flex-row justify-between mb-2">
                      <Text className="text-gray-500">
                        Estimated pick up time
                      </Text>
                      <Text className="font-medium">
                        {formatPickupTime(pickUpTime.toISOString())}
                      </Text>
                    </View>
                  </View>

                  {/* Order Details Toggle */}
                  <TouchableOpacity
                    onPress={() =>
                      setExpandedOrderId(
                        expandedOrderId === order.id ? null : order.id
                      )
                    }
                    className="px-4 py-2 border-t border-gray-200 flex-row justify-between items-center"
                  >
                    <Text className="text-primary font-medium">
                      {expandedOrderId === order.id
                        ? "Hide Details"
                        : "View Details"}
                    </Text>
                    <Feather
                      name={
                        expandedOrderId === order.id
                          ? "chevron-up"
                          : "chevron-down"
                      }
                      size={20}
                      color="#6B7280"
                    />
                  </TouchableOpacity>

                  {/* Expanded Order Details */}
                  {expandedOrderId === order.id && (
                    <View className="p-4 border-t border-gray-200">
                      <Text className="font-medium mb-3">Items</Text>
                      {order.desserts.map((item, index) => {
                        const itemTotalCostInCents =
                          item.customisations.reduce(
                            (total, customisationItem) => {
                              return (
                                total +
                                customisationItem.customisation.priceInCents *
                                  customisationItem.quantity
                              )
                            },
                            0
                          ) + item.dessert.priceInCents
                        return (
                          <View
                            key={item.id}
                            className={`flex-row items-center py-2 ${
                              index < order.desserts.length - 1
                                ? "border-b border-gray-100"
                                : ""
                            }`}
                          >
                            <View className="w-14 h-14 rounded-md mr-3 overflow-hidden">
                              <Image
                                source={{ uri: item.dessert.imagePath }}
                                style={{ width: "100%", height: "100%" }} // 8 * 4 = 32
                                resizeMode="cover"
                              />
                            </View>
                            <View className="flex-1">
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
                                {(itemTotalCostInCents / 100).toFixed(2)}
                              </Text>
                            </View>
                            <Text className="font-medium">
                              $
                              {(
                                (item.quantity * itemTotalCostInCents) /
                                100
                              ).toFixed(2)}
                            </Text>
                          </View>
                        )
                      })}
                    </View>
                  )}
                </View>
              )
            })}
          </View>
        )}

        {/* View Order History Button */}
        <TouchableOpacity
          onPress={() => router.push("/order-history")}
          className="bg-white border border-gray-300 py-3 rounded-lg items-center mb-8"
        >
          <Text className="font-medium">View All Order History</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  )
}
