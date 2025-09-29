"use client"

import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Switch,
  Platform,
  AppState,
  type AppStateStatus,
} from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { Feather } from "@expo/vector-icons"
import CustomHeader from "@/_components/custom-header"
import BouncingLoader from "@/_components/loader"
import { StripeProvider, useStripe } from "@stripe/stripe-react-native"
import {
  getSavedCards,
  createPaymentIntent,
  checkPaymentStatus,
} from "@/services/stripe-api"
import { useCartStore } from "@/store/cart"
import DateTimePicker from "@react-native-community/datetimepicker"
import { createOrder, checkOrderStatus } from "@/services/api"
import DateTimePickerModal from "react-native-modal-datetime-picker"
import { isOutsideBusinessHours } from "@/lib/businessHours"
import { useLoyaltyStore } from "@/store/points"
import {
  getEstimatedPickUpTime,
  getNextValidPickupTime,
  getOpenCloseTime,
} from "@/lib/checkoutHelpers"
import { useAuth } from "@/store/authProvider"
import { formatShortDate, roundToNearest5 } from "@/lib/formatters"
import Toast from "react-native-toast-message"

// Your Stripe publishable key - should be in environment variables
const STRIPE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY!

// Helper functions

function CheckoutContent() {
  const router = useRouter()
  const { confirmPayment } = useStripe()
  const { token, loading: loadingToken, usersMembership } = useAuth()
  const [savedCards, setSavedCards] = useState<any[]>([])
  const [loadingCards, setLoadingCards] = useState(true)
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [isProcessingPayment, setIsProcessingPayment] = useState(false)
  const [showAddCard, setShowAddCard] = useState(false)
  const getTotalItems = useCartStore((state) => state.getTotalItems)
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null)
  const [orderInProgress, setOrderInProgress] = useState<string | null>(null)
  const [isCheckingStatus, setIsCheckingStatus] = useState(false)
  const appState = useRef(AppState.currentState)

  // Cart items and total
  const cartItems = useCartStore((state) => state.items)
  const getTotalCost = useCartStore((state) => state.getTotalCost)
  const processOrder = useCartStore((state) => state.processOrder)

  // Pickup time state

  const [dineIn, setDineIn] = useState(false)
  const [pickupNow, setPickupNow] = useState(true)
  const [pickupDate, setPickupDate] = useState(
    getNextValidPickupTime(new Date(), getTotalItems())
  )
  const nextValidTime = useMemo(
    () => getNextValidPickupTime(new Date(), getTotalItems()),
    [pickupDate]
  )
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [showDoneButton, setShowDoneButton] = useState(false)
  const [showDate, setShowDate] = useState(false)
  const [showTime, setShowTime] = useState(false)
  const { closeTime } = getOpenCloseTime(pickupDate)

  // Fetch saved cards when component mounts

  useFocusEffect(
    useCallback(() => {
      if (token) {
        useCartStore.getState().fetchCart()
        fetchSavedCards()
      }
    }, [token])
  )

  const totalItems = getTotalItems()

  useEffect(() => {
    const interval = setInterval(() => {
      if (getEstimatedPickUpTime(totalItems).getTime() > pickupDate.getTime()) {
        setPickupDate(getNextValidPickupTime(new Date(), totalItems))
      }
    }, 60 * 1000)

    return () => clearInterval(interval)
  }, [pickupDate, totalItems])

  useEffect(() => {
    const subscription = AppState.addEventListener(
      "change",
      handleAppStateChange
    )

    return () => {
      subscription.remove()
    }
  }, [paymentIntentId, orderInProgress])

  const handleAppStateChange = async (nextAppState: AppStateStatus) => {
    // App has come back to the foreground
    if (
      appState.current.match(/inactive|background/) &&
      nextAppState === "active"
    ) {
      // Check if we have a payment intent or order in progress
      if (paymentIntentId) {
        await verifyPaymentStatus(paymentIntentId)
      } else if (orderInProgress) {
        await verifyOrderStatus(orderInProgress)
      }
    }

    appState.current = nextAppState
  }

  const verifyPaymentStatus = async (intentId: string) => {
    if (isCheckingStatus) return

    setIsCheckingStatus(true)
    try {
      const status = await checkPaymentStatus(intentId)

      if (status.success) {
        // Payment was successful, check if order was created
        if (status.orderId) {
          setOrderInProgress(status.orderId)
          await verifyOrderStatus(status.orderId)
        } else {
          // Payment succeeded but no order was created
          // This is an edge case - we should retry order creation
          Alert.alert(
            "Payment Processed",
            "Your payment was processed, but we couldn't send your order to the kitchen. Please check your orders or contact support.",
            [
              {
                text: "Check Orders",
                onPress: () => router.push("/orders"),
              },
              {
                text: "Try Again",
                style: "cancel",
              },
            ]
          )
        }
      } else if (status.pending) {
        // Payment is still processing
        setIsProcessingPayment(true)
      } else {
        // Payment failed
        Alert.alert(
          "Payment Failed",
          "Your payment could not be processed. Please try again."
        )
        setPaymentIntentId(null)
      }
    } catch (error) {
      console.error("Failed to check payment status:", error)
      Alert.alert(
        "Connection Error",
        "We couldn't verify your payment status. Please check your orders to see if your payment was processed.",
        [
          {
            text: "Check Orders",
            onPress: () => router.push("/orders"),
          },
          {
            text: "Dismiss",
            style: "cancel",
          },
        ]
      )
    } finally {
      setIsCheckingStatus(false)
    }
  }

  const verifyOrderStatus = async (orderId: string) => {
    if (isCheckingStatus) return

    setIsCheckingStatus(true)
    try {
      const orderStatus = await checkOrderStatus(orderId)

      if (orderStatus.success) {
        // Order was successful, clear cart and navigate to success page
        processOrder()
        setOrderInProgress(null)
        setPaymentIntentId(null)
        router.replace("/orders")
      } else {
        // Order failed or doesn't exist
        Alert.alert(
          "Order Status",
          "We couldn't verify your order status. Please check your orders or try again.",
          [
            {
              text: "Check My Orders",
              onPress: () => router.push("/orders"),
            },
            {
              text: "Try Again",
              style: "cancel",
            },
          ]
        )
        setOrderInProgress(null)
        setPaymentIntentId(null)
      }
    } catch (error) {
      console.error("Failed to check order status:", error)
      Alert.alert(
        "Connection Error",
        "We couldn't verify your order status. Your order may have been placed successfully. Please check your orders.",
        [
          {
            text: "Check My Orders",
            onPress: () => router.push("/orders"),
          },
          {
            text: "Dismiss",
            style: "cancel",
          },
        ]
      )
    } finally {
      setIsCheckingStatus(false)
    }
  }

  const fetchSavedCards = async () => {
    try {
      setLoadingCards(true)
      const cards = await getSavedCards()
      setSavedCards(cards)

      // Set the default card if available
      if (cards.length > 0) {
        // Find the default card or use the first one
        const defaultCard = cards.find((card) => card.isDefault) || cards[0]
        setSelectedCardId(defaultCard.id)
      }
    } catch (error) {
      console.error("Failed to fetch saved cards:", error)
      Alert.alert("Error", "Failed to load your saved payment methods.")
    } finally {
      setLoadingCards(false)
    }
  }

  const formatCardBrand = (brand: string) => {
    return brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase()
  }

  if (pickupDate > nextValidTime) {
    setPickupDate(roundToNearest5(nextValidTime))
  }

  const formatPickupTime = () => {
    if (pickupNow) {
      return "As soon as possible"
    } else {
      const day = pickupDate.getDate()
      const month = pickupDate.getMonth() + 1
      const hours = pickupDate.getHours()
      const minutes = pickupDate.getMinutes()
      const ampm = hours >= 12 ? "PM" : "AM"
      const formattedHours = hours % 12 || 12
      const formattedMinutes = minutes < 10 ? `0${minutes}` : minutes

      return `${day}/${month} ${formattedHours}:${formattedMinutes} ${ampm}`
    }
  }

  const handleConfirm = (date: Date) => {
    const validTime = getNextValidPickupTime(date, getTotalItems())
    const { openTime, closeTime, dayName } = getOpenCloseTime(date)
    if (validTime.getTime() !== date.getTime()) {
      Alert.alert(
        "Sorry, we are closed at that time",
        `Please choose a time during store hours. We are open ${openTime.toLocaleTimeString(
          "en-NZ",
          {
            hour: "2-digit",
            minute: "2-digit",
          }
        )} to ${closeTime.toLocaleTimeString("en-NZ", {
          hour: "2-digit",
          minute: "2-digit",
        })} on a ${dayName}.`
      )
      setPickupDate(validTime)
    } else {
      setPickupDate(date)
    }

    setShowDatePicker(false)
  }

  const onAndroidChangeDate = (event, selectedDate?: Date) => {
    if (event.type === "dismissed") {
      setShowDate(false)
      return
    }
    if (selectedDate) {
      setPickupDate(selectedDate)
    }
    if (event.type === "set") {
      setShowDate(false)
      setShowTime(true)
    } else {
      setShowDate(false)
    }
  }

  const onAndroidChangeTime = (event, selectedTime?: Date) => {
    if (event.type === "dismissed") {
      setShowTime(false)
      return
    }
    if (selectedTime) {
      const newDate = new Date(pickupDate)
      newDate.setHours(selectedTime.getHours())
      newDate.setMinutes(selectedTime.getMinutes())
      setPickupDate(newDate)
    }
    if (event.type === "set") {
      setShowTime(false)
    }
  }

  const handleOpenDatePicker = () => {
    if (Platform.OS === "ios") {
      setShowDatePicker(true)
      setShowDoneButton(false)
      setTimeout(() => {
        setShowDoneButton(true)
      }, 50)
    } else {
      setShowDate(true)
    }
  }

  const calculateGST = () => {
    return (getTotalCost() * 0.15) / 100 // 15% tax rate
  }

  const calculateTotal = () => {
    return getTotalCost() / 100
  }

  const calculateMembershipDiscount = () => {
    const originalPrice = Math.round(getTotalCost() / 0.85)
    return (originalPrice - getTotalCost()) / 100
  }

  const handlePlaceOrder = async () => {
    const totalAmount = Math.round(getTotalCost())
    const totalItems = getTotalItems()

    const pickUpNowTime = getEstimatedPickUpTime(totalItems)
    const notOpenYet =
      isOutsideBusinessHours(pickUpNowTime) ||
      isOutsideBusinessHours(pickupDate)
    if (notOpenYet && pickupNow) {
      Alert.alert(
        "We're closed or are not open yet. Please pick a suitable pick up time."
      )
      return
    }
    if (!selectedCardId || showAddCard) {
      Alert.alert("Please select a payment method or add a new card")
      return
    }

    if (cartItems.length === 0) {
      Alert.alert("Your cart is empty")
      return
    }

    setIsProcessingPayment(true)

    try {
      // Create order object

      const paymentMethodId = totalAmount > 0 ? selectedCardId : null
      const pickUpTime = pickupNow ? pickUpNowTime : pickupDate

      // Get payment intent client secret from your server

      if (totalAmount > 0) {
        const { clientSecret, paymentIntentId } = await createPaymentIntent(
          totalAmount,
          "nzd",
          selectedCardId
        )
        setPaymentIntentId(paymentIntentId)

        // Confirm the payment with Stripe
        const { error, paymentIntent } = await confirmPayment(clientSecret, {
          paymentMethodType: "Card",
          paymentMethodData: {
            paymentMethodId: selectedCardId,
          },
        })

        if (error) {
          throw new Error(error.message)
        }

        if (paymentIntent.status !== "Succeeded") {
          throw new Error(`Payment failed with status: ${paymentIntent.status}`)
        }

        // Payment succeeded, now create the order in your system

        const orderResponse = await createOrder(
          paymentMethodId,
          pickUpTime,
          dineIn,
          paymentIntent.id
        )
        // Try to extract the order ID if it exists in the error response
        if (!orderResponse) {
          throw new Error("Failed to create order")
        }
        setOrderInProgress(orderResponse.id)
      } else {
        // handle orders paid with points
        const orderResponse = await createOrder(null, pickUpTime, dineIn, null)
        if (!orderResponse) {
          throw new Error("Failed to create order")
        }
        setOrderInProgress(orderResponse.id)
      }

      // If total amount is 0, refresh loyalty points
      if (totalAmount === 0) {
        useLoyaltyStore.getState().fetchPoints()
      }

      // Clear cart
      await processOrder()

      router.push("/orders")
    } catch (error: any) {
      if (paymentIntentId) {
        Alert.alert(
          "Connection Issue",
          "Your payment may have been processed, but we couldn't confirm your order. Would you like to check the status?",
          [
            {
              text: "Check Status",
              onPress: () => verifyPaymentStatus(paymentIntentId),
            },
            {
              text: "View Orders",
              onPress: () => router.push("/orders"),
            },
          ]
        )
      } else {
        console.error(error)
        Toast.show({
          type: "error",
          text1: `${error.message}`,
          position: "bottom",
          visibilityTime: undefined,
          autoHide: false,
          bottomOffset: 60,
        })
      }
    } finally {
      setIsProcessingPayment(false)
    }
  }

  if (loadingToken || loadingCards) {
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
    router.replace("/signin")
    return null
  }

  if (cartItems.length === 0) {
    return (
      <View className="flex-1 bg-background">
        <CustomHeader />
        <View className="flex-1 items-center justify-center px-4">
          <Feather name="shopping-cart" size={64} color="#D1D5DB" />
          <Text className="mt-4 text-xl text-center text-gray-500">
            Your cart is empty
          </Text>
          <TouchableOpacity
            onPress={() => router.push("/")}
            className="mt-6 bg-primary py-3 px-6 rounded-lg"
          >
            <Text className="text-white font-medium">Start Shopping</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  return (
    <View className="flex-1 bg-background">
      <CustomHeader />
      <ScrollView className="flex-1">
        <View className="px-4 py-6">
          <Text className="text-2xl font-bold mb-6">Checkout</Text>

          {/* Order Summary */}
          <View className="bg-white rounded-xl shadow-sm p-4 mb-6">
            <Text className="text-lg font-medium mb-3">Order Summary</Text>

            {cartItems.map((item, index) => (
              <View
                key={item.id}
                className={`${
                  index < cartItems.length - 1
                    ? "border-b border-gray-100 py-4"
                    : "pt-4"
                }`}
              >
                <View key={index} className={`flex-row justify-between py-2`}>
                  <View className="flex-row items-center">
                    <View className="w-6 text-center mr-2">
                      <Text className="text-gray-500">{item.quantity}×</Text>
                    </View>
                    <Text>{item.dessert.name}</Text>
                  </View>

                  <Text className="font-medium">
                    $
                    {(
                      Math.round(
                        (item.itemPriceInCents * item.quantity) /
                          (usersMembership?.isActive ? 0.85 : 1)
                      ) / 100
                    ).toFixed(2)}
                  </Text>
                </View>
                {item.customisations.map((customisation) => (
                  <Text key={customisation.id}>{`${
                    customisation.quantity === 0 ? `- ` : `+ `
                  } ${customisation.name} ${
                    customisation.quantity > 1
                      ? `x${customisation.quantity}`
                      : ``
                  }`}</Text>
                ))}
              </View>
            ))}

            <View className="mt-4 pt-3 border-t border-gray-200">
              {usersMembership?.isActive && (
                <View className="flex-row justify-between mb-1">
                  <Text className="text-gray-500">
                    Membership Discount Included (15%)
                  </Text>
                  <Text className="font-medium">
                    - ${calculateMembershipDiscount().toFixed(2)}
                  </Text>
                </View>
              )}
              <View
                className={`flex-row justify-between ${
                  usersMembership?.isActive
                    ? "mt-2 pt-2 border-t border-gray-200"
                    : ""
                }`}
              >
                <Text className="text-gray-500">GST Included (15%)</Text>
                <Text className="font-medium">
                  ${calculateGST().toFixed(2)}
                </Text>
              </View>
              <View className="flex-row justify-between mt-2 pt-2 border-t border-gray-200">
                <Text className="font-bold">Total</Text>
                <Text className="font-bold">
                  ${calculateTotal().toFixed(2)}
                </Text>
              </View>
            </View>
          </View>

          {/* Pickup Time */}
          <View className="bg-white rounded-xl shadow-sm p-4 mb-6">
            <View className=" mb-3 flex-row items-center gap-3">
              <TouchableOpacity
                onPress={() => setDineIn(false)}
                className={`px-5 py-3 rounded-lg ${
                  dineIn ? "bg-gray-300" : "bg-primary"
                }`}
              >
                <Text>Pick up</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setDineIn(true)}
                className={`px-5 py-3 rounded-lg  ${
                  dineIn ? "bg-primary" : "bg-gray-300"
                }`}
              >
                <Text>Eat in</Text>
              </TouchableOpacity>
            </View>
            <View className="mb-3 justify-between flex-row items-center">
              <Text className="text-lg font-medium">
                {dineIn ? "Eat In Date" : "Pick Up Date"}
              </Text>
              {pickupNow && <Text>{formatShortDate(nextValidTime)}</Text>}
            </View>

            <View className="flex-row items-center justify-between mb-4">
              <Text>{dineIn ? "Eat in" : "Pickup"} as soon as possible</Text>
              <Switch value={pickupNow} onValueChange={setPickupNow} />
            </View>

            {!pickupNow && (
              <View>
                <TouchableOpacity
                  onPress={handleOpenDatePicker}
                  className="flex-row items-center justify-between p-3 border border-gray-200 rounded-lg"
                >
                  <Text>{formatPickupTime()}</Text>
                  <Feather name="clock" size={20} color="#6B7280" />
                </TouchableOpacity>

                {Platform.OS === "ios" && showDatePicker && (
                  <DateTimePickerModal
                    isVisible={showDatePicker}
                    mode="datetime"
                    date={roundToNearest5(nextValidTime)}
                    minuteInterval={5}
                    onConfirm={handleConfirm}
                    onCancel={() => setShowDatePicker(false)}
                    minimumDate={roundToNearest5(nextValidTime)}
                    maximumDate={(() => {
                      const date = new Date() // Create a new Date object
                      date.setMonth(date.getMonth() + 1)
                      return date
                    })()}
                  />
                )}

                {Platform.OS === "android" && showDate && (
                  <DateTimePicker
                    value={pickupDate}
                    mode="date"
                    display="calendar"
                    onChange={onAndroidChangeDate}
                    minimumDate={nextValidTime}
                    maximumDate={(() => {
                      const date = new Date() // Create a new Date object
                      date.setMonth(date.getMonth() + 1)
                      return date
                    })()}
                  />
                )}

                {Platform.OS === "android" && showTime && (
                  <DateTimePicker
                    value={pickupDate}
                    mode="time"
                    display="spinner"
                    onChange={onAndroidChangeTime}
                    minimumDate={nextValidTime}
                    maximumDate={closeTime}
                  />
                )}
                {Platform.OS === "ios" && showDoneButton && showDatePicker && (
                  <TouchableOpacity
                    onPress={() => setShowDatePicker(false)}
                    className="self-center bg-primary w-1/3 items-center p-2 rounded-lg"
                  >
                    <Text className="text-xl text-white">Done</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            <Text className="text-sm text-gray-500 mt-2">
              {pickupNow
                ? "Your order will be ready in approximately 5-15 minutes, alternatively have your notifications turned on to receive real time changes to your order(s) status."
                : "Please have the apps notifications turned on to receive real time changes to your order(s) status or arrive at your selected time to pick up your order."}
            </Text>
          </View>

          {/* Payment Method */}
          {getTotalCost() > 0 && (
            <View className="bg-white rounded-xl shadow-sm p-4 mb-6">
              <View className="flex-row justify-between items-center mb-3">
                <Text className="text-lg font-medium">Payment Method</Text>
                <TouchableOpacity
                  onPress={() => router.push("/payment-methods")}
                >
                  <Text className="text-primary">Manage</Text>
                </TouchableOpacity>
              </View>

              {savedCards.length > 0 ? (
                <View>
                  {savedCards.map((card) => (
                    <TouchableOpacity
                      key={card.id}
                      onPress={() => {
                        setSelectedCardId(card.id)
                        setShowAddCard(false)
                      }}
                      className={`flex-row items-center justify-between p-3 mb-2 border rounded-lg ${
                        selectedCardId === card.id && !showAddCard
                          ? "border-primary bg-primary/5"
                          : "border-gray-200"
                      }`}
                    >
                      <View className="flex-row items-center">
                        <Feather name="credit-card" size={20} color="#6B7280" />
                        <Text className="ml-2">
                          {formatCardBrand(card.card.brand)} ••••{" "}
                          {card.card.last4}
                        </Text>
                      </View>
                      {selectedCardId === card.id && !showAddCard && (
                        <Feather name="check" size={20} color="#10B981" />
                      )}
                    </TouchableOpacity>
                  ))}

                  <TouchableOpacity
                    onPress={() => {
                      setShowAddCard(true)
                      setSelectedCardId(null)
                    }}
                    className={`flex-row items-center justify-between p-3 border rounded-lg ${
                      showAddCard
                        ? "border-primary bg-primary/5"
                        : "border-gray-200"
                    }`}
                  >
                    <View className="flex-row items-center">
                      <Feather name="plus" size={20} color="#6B7280" />
                      <Text className="ml-2">Add new card</Text>
                    </View>
                    {showAddCard && (
                      <Feather name="check" size={20} color="#10B981" />
                    )}
                  </TouchableOpacity>
                </View>
              ) : (
                <View className="items-center py-4">
                  <Feather name="credit-card" size={32} color="#D1D5DB" />
                  <Text className="mt-2 text-gray-500">
                    No payment methods found
                  </Text>
                  <TouchableOpacity
                    onPress={() => router.push("/payment-methods")}
                    className="mt-3 bg-primary py-2 px-4 rounded-lg"
                  >
                    <Text className="text-white">Add Payment Method</Text>
                  </TouchableOpacity>
                </View>
              )}

              {showAddCard && (
                <View className="mt-4">
                  <Text className="text-gray-500 mb-2">
                    Add a new card at checkout
                  </Text>
                  <TouchableOpacity
                    onPress={() =>
                      router.push({
                        pathname: "/payment-methods",
                        params: { returnToCheckout: "true" },
                      })
                    }
                    className="bg-primary py-3 rounded-lg items-center"
                  >
                    <Text className="text-white font-medium">Add New Card</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {/* Place Order Button */}
          <TouchableOpacity
            onPress={handlePlaceOrder}
            className="bg-primary py-4 rounded-lg items-center"
            disabled={isProcessingPayment || cartItems.length === 0}
          >
            {isProcessingPayment ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text className="text-white font-bold text-lg">Place Order</Text>
            )}
          </TouchableOpacity>

          {/* Stripe Information */}
          <View className="mt-4">
            <View className="flex-row items-center justify-center mb-2">
              <Feather name="lock" size={14} color="#6B7280" />
              <Text className="text-gray-500 text-sm ml-1">
                Payments secured by Stripe
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  )
}

export default function CheckoutWithStripe() {
  return (
    <StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY}>
      <CheckoutContent />
    </StripeProvider>
  )
}
