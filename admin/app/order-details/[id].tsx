"use client"

import { CustomerDetails } from "@/components/customer-details"
import { StatusBadge } from "@/components/status-badge"
import { StatusUpdateModal } from "@/components/status-update-modal"
import { formatCurrency, formatDate } from "@/lib/formatters"
import { OrderStatus } from "@/lib/types"
import { useOrderContext } from "@/providers/order-provider"
import printerService from "@/services/printer-service"
import { Ionicons } from "@expo/vector-icons"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { useState } from "react"
import {
  Image,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native"
import Toast from "react-native-toast-message"

const getScreenOptions = () => ({
  title: ` Order details`,
  headerTitleStyle: {
    fontFamily: "Inter-SemiBold",
  },
})

export default function OrderDetails() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { findOrderById, updateOrderStatus } = useOrderContext()
  const [statusModalVisible, setStatusModalVisible] = useState(false)

  const order = findOrderById(id)

  const handleStatusUpdate = async (newStatus: OrderStatus) => {
    try {
      if (!order) {
        return
      }
      await updateOrderStatus(order.id, newStatus)

      // First hide the modal
      setStatusModalVisible(false)
      // Slight delay before going back to avoid transition conflicts

      // setTimeout(() => {
      //   router.back()
      // }, 100) // You can fine-tune the delay if needed
    } catch (error) {
      console.error("Failed to update order status:", error)
      // Optionally show a toast/snackbar or error message
    }
  }

  const printReceipt = async () => {
    try {
      if (!order) {
        return
      }
      const success = await printerService.enqueue({
        id: order.id,
        order: order,
        createdAt: new Date().toISOString(),
        status: "pending",
      })
      if (success === true) {
        Toast.show({
          type: "success",
          text1: `Order has been printed`,
          position: "bottom",
          visibilityTime: 3000,
          autoHide: true,
          bottomOffset: 60,
        })
      }
    } catch (error) {
      Toast.show({
        type: "error",
        text1: error instanceof Error ? error.message : "Something went wrong",
        position: "bottom",
        visibilityTime: 3000,
        autoHide: true,
        bottomOffset: 60,
      })
    }
  }

  const hasCustomizations = order?.desserts?.some(
    (item) => item?.customisations && item?.customisations?.length > 0,
  )

  if (!order) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <Ionicons name="alert-circle-outline" size={48} color="#EF4444" />
        <Text className="mt-4 text-lg font-medium">Order not found</Text>
        <TouchableOpacity
          className="mt-4 bg-indigo-600 px-4 py-2 rounded-lg"
          onPress={() => router.back()}
        >
          <Text className="text-white font-medium">Go Back</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <>
      <Stack.Screen
        options={{
          ...getScreenOptions(),
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} className="ml-2">
              <Ionicons name="arrow-back" size={24} color="#000" />
            </TouchableOpacity>
          ),
        }}
      />

      <View className="flex-1">
        <ScrollView>
          {/* Order Header */}
          <View
            className={`bg-white p-4 ${
              Platform.OS === "android" ? "pt-10" : "pt-0"
            }`}
          >
            <View className="flex-row justify-between items-center mb-2">
              <Text className="text-2xl font-bold">
                Order #{order.tempOrderId}
              </Text>
              <StatusBadge status={order.status} />
            </View>
            <Text className="text-gray-500">
              {formatDate(new Date(order.createdAt).toISOString())}
            </Text>

            {hasCustomizations && (
              <View className="mt-2 bg-amber-50 px-3 py-2 rounded-lg border border-amber-200 flex-row items-center">
                <Ionicons name="alert-circle" size={18} color="#F59E0B" />
                <Text className="text-amber-800 ml-2 font-medium">
                  This order has customisations
                </Text>
              </View>
            )}

            <View className="flex-row justify-between mt-4">
              {order.status === "PENDING" ? (
                <View className="flex-row flex-1">
                  <TouchableOpacity
                    className="flex-1 mr-1 bg-green-500 py-3 rounded-lg items-center justify-center"
                    onPress={() => handleStatusUpdate("ACCEPTED")}
                  >
                    <Text className="text-white font-medium">Accept</Text>
                  </TouchableOpacity>

                  {/* <TouchableOpacity
                    className="flex-1 ml-1 bg-red-500 py-3 rounded-lg items-center justify-center"
                    onPress={() => handleStatusUpdate("DECLINED")}
                  >
                    <Text className="text-white font-medium">Decline</Text>
                  </TouchableOpacity> */}
                </View>
              ) : (
                <TouchableOpacity
                  className="flex-1 bg-indigo-600 py-3 rounded-lg items-center justify-center"
                  onPress={() => setStatusModalVisible(true)}
                >
                  <Text className="text-white font-medium">Update Status</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Order Items */}
          <View className="bg-white mt-4 p-4">
            <View className="justify-between flex-row items-center">
              <Text className="text-lg font-semibold mb-4">Order Items</Text>
              <TouchableOpacity onPress={printReceipt}>
                <Ionicons name="print-outline" size={30} color="#3B82F6" />
              </TouchableOpacity>
            </View>

            {order.desserts.map((item, index) => {
              const customisationPrice = item.customisations.reduce(
                (acc, c) =>
                  acc +
                  (c.quantity > 0
                    ? (c.customisation.priceInCents -
                        c.discountedAmountInCents) *
                      c.quantity
                    : 0),
                0,
              )
              const pricePerItem =
                (item.priceInCents -
                  item.discountedAmountInCents +
                  customisationPrice) /
                100

              return (
                <View
                  key={index}
                  className={`flex-row py-3 ${
                    index < order.desserts.length - 1
                      ? "border-b border-gray-100"
                      : ""
                  }`}
                >
                  <Image
                    source={{
                      uri:
                        item.dessert.imagePath ||
                        "https://via.placeholder.com/60",
                    }}
                    className="w-16 h-16 rounded-lg bg-gray-200"
                  />

                  <View className="flex-1 ml-3">
                    <View className="flex-row justify-between">
                      <Text className="font-medium text-base">
                        {item.dessert.name}
                      </Text>
                      <Text className="font-medium">
                        {formatCurrency(pricePerItem)}
                      </Text>
                    </View>

                    <Text className="text-gray-500">Qty: {item.quantity}</Text>

                    {item.customisations && item.customisations.length > 0 && (
                      <View className="mt-1 bg-gray-50 p-2 rounded-md">
                        {item.customisations.map((custom) => (
                          <View
                            key={custom.id}
                            className="flex-row justify-between items-center mb-1"
                          >
                            <Text className="text-gray-600 text-sm">
                              • {custom.customisation.name}: {custom.quantity}x
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                </View>
              )
            })}

            {/* Order Totals */}
            <View className="mt-4 pt-3 border-t border-gray-200">
              <View className="flex-row justify-between mb-1">
                <Text className="text-gray-500">GST</Text>
                <Text>{formatCurrency(order.GST / 100)}</Text>
              </View>

              <View className="flex-row justify-between pt-2 mt-2 border-t border-gray-200">
                <Text className="font-bold text-base">Total</Text>
                <Text className="font-bold text-base">
                  {formatCurrency(
                    (order.priceInCents - order.discountedAmountInCents) / 100,
                  )}
                </Text>
              </View>
            </View>
          </View>

          {/* Customer Details */}
          <CustomerDetails
            customer={{
              firstName: order.customerFirstName,
              lastName: order.customerLastName,
              email: order.customerEmail,
              phone: order.customerPhoneNumber,
            }}
          />

          {/* Order Notes */}
          {/* {order.notes && (
            <View className="bg-white mt-4 p-4 mb-6">
              <Text className="text-lg font-semibold mb-2">Order Notes</Text>
              <View className="bg-gray-50 p-3 rounded-lg">
                <Text className="text-gray-700">{order.notes}</Text>
              </View>
            </View>
          )} */}

          {/* Bottom spacing */}
          <View className="h-6" />
        </ScrollView>
      </View>

      {/* Status Update Modal */}

      <StatusUpdateModal
        visible={statusModalVisible}
        currentStatus={order.status}
        onClose={() => setStatusModalVisible(false)}
        onStatusUpdate={handleStatusUpdate}
      />
    </>
  )
}
