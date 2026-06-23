"use client"

import { formatCurrency, getCollectionTime } from "@/lib/formatters"
import { Order } from "@/lib/types"
import { useOrderContext } from "@/providers/order-provider"
import newOrderServices from "@/services/newOrders-service"
import { Ionicons } from "@expo/vector-icons"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { useAudioPlayer } from "expo-audio"
import { router } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { useEffect, useRef } from "react"
import {
  Animated,
  Dimensions,
  Modal,
  Text,
  TouchableOpacity,
  View,
} from "react-native"

export default function NewOrderModal({
  order,
  visible,
}: {
  order: Order
  visible: boolean
}) {
  const { updateOrderStatus } = useOrderContext()
  const fadeAnim = useRef(new Animated.Value(0)).current
  const windowHeight = Dimensions.get("window").height
  const hasAccepted = useRef(false)
  const player = useAudioPlayer(
    require("../../assets/sounds/chinese-justin.mp3"),
  )
  const totalItems = order?.desserts?.reduce(
    (total, item) => total + item.quantity,
    0,
  )

  useEffect(() => {
    hasAccepted.current = false
  }, [order.id])

  // Play notification sound and animation when component mounts
  useEffect(() => {
    const fadeIn = Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    })

    fadeIn.start()
    if (player) {
      const checkSoundAndPlay = async () => {
        const soundEnabled = await AsyncStorage.getItem("soundEnabled")
        if (soundEnabled !== "false") {
          player.play()
        }
      }
      checkSoundAndPlay()

      // Set up the listener for the looping logic
      // player.addListener("playbackStatusUpdate", async (status) => {
      //   const soundEnabled = await AsyncStorage.getItem("soundEnabled")
      //   // If sound is not explicitly disabled
      //   if (soundEnabled !== "false") {
      //     try {
      //       // Check if playback has finished
      //       if (status.didJustFinish) {
      //         // Rewind and play again
      //         await player.seekTo(0)
      //         player.play()
      //       }
      //     } catch (error) {
      //       console.error("Error playing sound", error)
      //     }
      //   }
      // })
    }

    // Check if auto-accept is enabled
    const checkAutoAccept = async () => {
      const autoAccept = await AsyncStorage.getItem("autoAccept")
      if (autoAccept === "true" && order) {
        setTimeout(() => {
          handleAccept()
        }, 3000) // Auto-accept after 2 seconds
      }
    }

    checkAutoAccept()
  }, [player])

  if (!visible) {
    return
  }

  const handleAccept = async () => {
    if (hasAccepted.current) return

    hasAccepted.current = true

    try {
      await updateOrderStatus(order.id, "ACCEPTED")

      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(() => {
        newOrderServices.resolveCurrentAlert()
      })
    } catch (error) {
      hasAccepted.current = false
      console.error(error)
    }
  }

  // const handleDecline = async () => {
  //   // Fade out animation before closing
  //   await updateOrderStatus(order.id, "DECLINED")
  //   Animated.timing(fadeAnim, {
  //     toValue: 0,
  //     duration: 200,
  //     useNativeDriver: true,
  //   }).start(() => {
  //     // if (router.canGoBack?.()) {
  //     //   router.back()
  //     // }
  //   })

  //   return
  // }
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <View className="flex-1 items-center justify-center bg-black/60">
        <StatusBar style="light" />

        <Animated.View
          style={{
            opacity: fadeAnim,
            transform: [
              {
                translateY: fadeAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [windowHeight * 0.1, 0],
                }),
              },
            ],
          }}
          className="bg-white m-8 rounded-xl overflow-hidden w-11/12 max-w-2xl shadow-2xl"
        >
          {/* Header */}
          <View className="bg-indigo-600 p-4">
            <View className="flex-row items-center">
              <Ionicons name="notifications" size={24} color="white" />
              <Text className="text-white text-lg font-bold ml-2">
                New Order Request
              </Text>
            </View>
          </View>

          {/* Order summary */}
          <View className="p-4">
            <Text className="text-gray-500 mb-4">
              {getCollectionTime(new Date())}
            </Text>
            <Text className="text-gray-500 mb-4">
              {order?.dineIn ? "Eat in" : "Pick up"} at{" "}
              {getCollectionTime(new Date(order.pickUpTime))}
            </Text>
            <View className="flex-row justify-between mb-2">
              <Text className="text-xl font-semibold">
                Order #{order.tempOrderId}
              </Text>
              <Text className="font-bold text-lg">
                {formatCurrency(
                  (order.priceInCents - order.discountedAmountInCents) / 100,
                )}
              </Text>
            </View>

            <Text className="text-gray-500 mb-4">{totalItems} items</Text>

            {/* Order items preview */}
            <View className="bg-gray-50 rounded-lg p-3 mb-4">
              {order.desserts.slice(0, 3).map((item) => {
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
                  <View key={item.id} className="flex-row justify-between mb-1">
                    <View className="flex-col">
                      <Text className="text-gray-700 text-lg">
                        {item.quantity}x {item.dessert.name}
                      </Text>
                      {item.customisations.map((customisation) => (
                        <Text
                          className="text-gray-700 ml-2"
                          key={customisation.id}
                        >
                          {customisation.quantity === 0 ? "-" : "+"}
                          {customisation.quantity}x{" "}
                          {customisation.customisation.name}
                        </Text>
                      ))}
                    </View>

                    <Text className="text-gray-700">
                      {formatCurrency(pricePerItem * item.quantity)}
                    </Text>
                  </View>
                )
              })}

              {order.desserts.length > 3 && (
                <Text className="text-gray-500 text-center mt-1">
                  +{order.desserts.length - 3} more items
                </Text>
              )}
            </View>

            {/* Customer info */}
            <View className="mb-5">
              <Text className="font-medium mb-1">Customer</Text>
              <Text className="text-gray-700">{`${order.customerFirstName} ${order.customerLastName}`}</Text>
              <Text className="text-gray-500">{order.customerPhoneNumber}</Text>
            </View>

            {/* Has customizations notice */}
            {order.desserts.some(
              (item) => item.customisations && item.customisations.length > 0,
            ) && (
              <View className="bg-amber-50 p-3 rounded-lg border border-amber-200 mb-4 flex-row items-center">
                <Ionicons name="alert-circle" size={20} color="#F59E0B" />
                <Text className="text-amber-800 ml-2">
                  This order has special instructions
                </Text>
              </View>
            )}

            {/* Accept/Decline buttons */}
            <View className="flex-row mt-2">
              {/* <TouchableOpacity
              className="flex-1 bg-red-500 py-3 rounded-lg items-center justify-center mr-2"
              onPress={handleDecline}
            >
              <Text className="text-white font-medium">Decline</Text>
            </TouchableOpacity> */}

              <TouchableOpacity
                className="flex-1 bg-green-500 py-3 rounded-lg items-center justify-center ml-2"
                onPress={handleAccept}
                disabled={hasAccepted.current}
              >
                <Text className="text-white font-medium">Accept</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              className="mt-3 py-2 items-center"
              onPress={() => router.push(`/order-details/${order.id}`)}
            >
              <Text className="text-indigo-600 font-medium">
                View Complete Details
              </Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  )
}
