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
import {
  createOrder,
  checkOrderStatus,
  getRestaurantStatus,
} from "@/services/api"
import DateTimePickerModal from "react-native-modal-datetime-picker"
import { isOutsideBusinessHours } from "@/lib/businessHours"
import { useLoyaltyStore } from "@/store/points"
import {
  getEstimatedPickUpTime,
  getNextValidPickupTime,
  getOpenCloseTime,
} from "@/lib/checkoutHelpers"
import { useAuth } from "@/store/authProvider"
import {
  formatCurrency,
  formatShortDate,
  roundToNearest5,
} from "@/lib/formatters"
import Toast from "react-native-toast-message"
import useFetch from "@/services/use_fetch"
import { openPaymentSheetForSetup } from "@/utils/stripeMethod"

// Your Stripe publishable key - should be in environment variables
const STRIPE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY!

// Helper functions

function CheckoutContent() {
  const router = useRouter()
  const { confirmPayment, initPaymentSheet, presentPaymentSheet } = useStripe()
  const {
    token,
    loading: loadingToken,
    usersMembership,
    storeHours,
  } = useAuth()
  const { data: restaurantStatus, loading } = useFetch(() =>
    getRestaurantStatus()
  )
  const [savedCards, setSavedCards] = useState<any[]>([])
  const [loadingCards, setLoadingCards] = useState(true)
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [isProcessingPayment, setIsProcessingPayment] = useState(false)
  const [showAddCard, setShowAddCard] = useState(false)
  const [loadingPaymentSheet, setLoadingPaymentSheet] = useState(false)
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null)
  const [orderInProgress, setOrderInProgress] = useState<string | null>(null)
  const [isCheckingStatus, setIsCheckingStatus] = useState(false)
  const appState = useRef(AppState.currentState)
  const [showEatInError, setShowEatInError] = useState(false)

  // Cart items and total
  const cartOperations = useCartStore((state) => state.cartOperations)
  const cartItems = useCartStore((state) => state.items)
  const getTotalMembershipDiscount = useCartStore(
    (state) => state.getTotalMembershipDiscount
  )
  const getTotalItems = useCartStore((state) => state.getTotalItems)
  const getTotalCost = useCartStore((state) => state.getTotalCost)
  const processOrder = useCartStore((state) => state.processOrder)
  const totalItems = getTotalItems()
  const totalPrice = getTotalCost()

  // Pickup time state

  const [eatIn, setEatIn] = useState(false)
  const [eatInDate, setEatInDate] = useState(
    getNextValidPickupTime(new Date(), getTotalItems(), storeHours)
  )
  const [pickupNow, setPickupNow] = useState(true)
  const [pickupDate, setPickupDate] = useState(
    getNextValidPickupTime(new Date(), getTotalItems(), storeHours)
  )

  // const nextValidTime = useMemo(
  //   () => getNextValidPickupTime(new Date(), getTotalItems(), storeHours),
  //   [pickupDate]
  // )
  const [nextValidTime, setNextValidTime] = useState(
    getNextValidPickupTime(new Date(), getTotalItems(), storeHours)
  )
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [showDoneButton, setShowDoneButton] = useState(false)
  const [showDate, setShowDate] = useState(false)
  const [showTime, setShowTime] = useState(false)
  const { closeTime } = getOpenCloseTime(
    eatIn ? eatInDate : pickupDate,
    storeHours
  )

  // Fetch saved cards when component mounts

  useFocusEffect(
    useCallback(() => {
      if (token) {
        // useCartStore.getState().fetchCart()
        fetchSavedCards()
      }
    }, [token])
  )

  useEffect(() => {
    if (cartOperations === 0) {
      const getNewItems = async () => {
        await useCartStore.getState().fetchCart()
        // useCartStore.getState().getTotalItems()
      }
      getNewItems()
    }
  }, [cartOperations])

  useEffect(() => {
    const interval = setInterval(() => {
      setNextValidTime(
        getNextValidPickupTime(new Date(), getTotalItems(), storeHours)
      )
      if (
        getEstimatedPickUpTime(totalItems)?.getTime() > pickupDate?.getTime()
      ) {
        setPickupDate(
          getNextValidPickupTime(new Date(), totalItems, storeHours)
        )
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

  const handlePaymentSheet = async () => {
    setLoadingPaymentSheet(true)
    await openPaymentSheetForSetup(
      { initPaymentSheet, presentPaymentSheet },
      fetchSavedCards
    )
    setLoadingPaymentSheet(false)
  }

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
                onPress: () => router.replace("/orders"),
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
            onPress: () => router.replace("/orders"),
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
              onPress: () => router.replace("/orders"),
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
            onPress: () => router.replace("/orders"),
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

  const formatPickupTime = () => {
    if (!pickupDate) {
      return "Closed"
    } else if (pickupNow) {
      return "As soon as possible"
    } else {
      const day = eatIn ? eatInDate.getDate() : pickupDate.getDate()
      const month = eatIn ? eatInDate.getMonth() + 1 : pickupDate.getMonth() + 1
      const hours = eatIn ? eatInDate.getHours() : pickupDate.getHours()
      const minutes = eatIn ? eatInDate.getMinutes() : pickupDate.getMinutes()
      const ampm = hours >= 12 ? "PM" : "AM"
      const formattedHours = hours % 12 || 12
      const formattedMinutes = minutes < 10 ? `0${minutes}` : minutes

      return `${day}/${month} ${formattedHours}:${formattedMinutes} ${ampm}`
    }
  }

  const alertTimeChange = (date: Date) => {
    const { openTime, closeTime, dayName } = getOpenCloseTime(date, storeHours)

    if (!openTime && !closeTime) {
      Alert.alert("Sorry, we are closed on that day...")
    } else {
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
    }
  }

  const handleConfirm = (date: Date) => {
    const validTime = getNextValidPickupTime(date, getTotalItems(), storeHours)
    if (!validTime) {
      alertTimeChange(null)
    } else if (validTime.getTime() !== date.getTime()) {
      alertTimeChange(date)
      eatIn ? setEatInDate(nextValidTime) : setPickupDate(nextValidTime)
    } else {
      eatIn ? setEatInDate(date) : setPickupDate(date)
    }

    setShowDatePicker(false)
  }

  const onAndroidChangeDate = (event, selectedDate?: Date) => {
    if (event.type === "dismissed") {
      setShowDate(false)
      return
    }
    const validTime = getNextValidPickupTime(
      selectedDate,
      getTotalItems(),
      storeHours
    )
    if (!validTime) {
      alertTimeChange(null)
      eatIn ? setEatInDate(nextValidTime) : setPickupDate(nextValidTime)
    } else if (selectedDate) {
      if (validTime.getTime() !== selectedDate.getTime()) {
        alertTimeChange(selectedDate)
        eatIn ? setEatInDate(validTime) : setPickupDate(validTime)
      } else {
        eatIn ? setEatInDate(selectedDate) : setPickupDate(selectedDate)
      }
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
    const validTime = getNextValidPickupTime(
      selectedTime,
      getTotalItems(),
      storeHours
    )
    if (!validTime) {
      alertTimeChange(null)
      eatIn ? setEatInDate(nextValidTime) : setPickupDate(nextValidTime)
    } else if (selectedTime) {
      if (validTime.getTime() !== selectedTime.getTime()) {
        alertTimeChange(selectedTime)
        eatIn ? setEatInDate(validTime) : setPickupDate(validTime)
      } else {
        const newDate = new Date(pickupDate)
        newDate.setHours(selectedTime.getHours())
        newDate.setMinutes(selectedTime.getMinutes())
        eatIn ? setEatInDate(newDate) : setPickupDate(newDate)
      }
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
    return getTotalMembershipDiscount() / 100
  }

  const handlePlaceOrder = async () => {
    if (!nextValidTime) {
      Alert.alert(
        "We're closed for the time being, sorry for any inconvenience caused"
      )
      return
    }
    const totalAmount = Math.round(getTotalCost())
    const totalItems = getTotalItems()

    const pickUpNowTime = getEstimatedPickUpTime(totalItems)
    const notOpenYet = pickupNow
      ? isOutsideBusinessHours(pickUpNowTime, storeHours)
      : eatIn
      ? isOutsideBusinessHours(eatInDate, storeHours)
      : isOutsideBusinessHours(pickupDate, storeHours)
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

    if (cartItems?.length === 0) {
      Alert.alert("Your cart is empty")
      return
    }

    setIsProcessingPayment(true)

    try {
      // Create order object

      const paymentMethodId = totalAmount > 0 ? selectedCardId : null
      const pickUpTime = pickupNow
        ? pickUpNowTime
        : eatIn
        ? eatInDate
        : pickupDate

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
          pickupNow,
          pickUpTime,
          eatIn,
          paymentIntent.id
        )
        // Try to extract the order ID if it exists in the error response
        if (!orderResponse) {
          throw new Error("Failed to create order")
        }
        setOrderInProgress(orderResponse.id)
      } else {
        // handle orders paid with points
        const orderResponse = await createOrder(
          null,
          pickupNow,
          pickUpTime,
          eatIn,
          null
        )
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

      router.replace("/orders")
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
              onPress: () => router.replace("/orders"),
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

  const handleEatIn = () => {
    if (
      restaurantStatus?.unavailableUntil
        ? new Date(restaurantStatus?.unavailableUntil).getTime() > // if unavailableUntil is null and dine in availablility is false = indefinite unavailablility so don't allow eat in now.
          nextValidTime.getTime()
        : true && // if next valid time time to collect > unavailableUntil then it means unavailableUntil time has passed so can collect ASAP
          !restaurantStatus?.dineInAvailability // if dine in availablility is true, allow eat in now. else don't allow
    ) {
      setPickupNow(false)
    }
    if (
      !restaurantStatus?.dineInAvailability &&
      !restaurantStatus?.unavailableUntil
    ) {
      setShowEatInError(true)
      setTimeout(() => setShowEatInError(false), 3000) // hide after 3s
      return
    } else if (
      !restaurantStatus?.dineInAvailability &&
      restaurantStatus?.unavailableUntil &&
      new Date(restaurantStatus?.unavailableUntil).getTime() >
        nextValidTime?.getTime()
    ) {
      setEatInDate(new Date(restaurantStatus?.unavailableUntil))
    } else {
      setEatInDate(nextValidTime)
    }
    setEatIn(true)
  }

  const getMinTime = () => {
    return eatIn &&
      !restaurantStatus?.dineInAvailability &&
      restaurantStatus?.unavailableUntil &&
      new Date(restaurantStatus?.unavailableUntil) > nextValidTime
      ? roundToNearest5(new Date(restaurantStatus?.unavailableUntil))
      : roundToNearest5(nextValidTime)
  }

  if (loadingToken || loadingCards || cartOperations > 0 || loading) {
    return (
      <View className="flex-1 bg-background">
        <CustomHeader />
        <View className="flex-1 items-center justify-center">
          <View className="flex-row items-center justify-center gap-2">
            <Text className="text-primary font-semibold">
              Sorting your items
            </Text>
            <BouncingLoader />
          </View>
        </View>
      </View>
    )
  }

  if (!token) {
    router.replace("/signin")
    return null
  }

  if (cartItems?.length === 0) {
    return (
      <View className="flex-1 bg-background">
        <CustomHeader />
        <View className="flex-1 items-center justify-center px-4">
          <Feather name="shopping-cart" size={64} color="#D1D5DB" />
          <Text className="mt-4 text-xl text-center text-gray-500">
            Your cart is empty
          </Text>
          <TouchableOpacity
            onPress={() => router.replace("/(tabs)/menu")}
            className="mt-6 bg-primary py-3 px-6 rounded-lg"
          >
            <Text className="text-white font-medium">Start Ordering</Text>
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
                <View key={index} className="flex-row justify-between py-2">
                  {/* LEFT SIDE */}
                  <View className="flex-1 flex-row items-center pr-2">
                    <View className="w-6 mr-2">
                      <Text className="text-gray-500 text-center">
                        {item.quantity}×
                      </Text>
                    </View>

                    <Text
                      numberOfLines={2}
                      ellipsizeMode="tail"
                      className="flex-shrink"
                    >
                      {item.dessert.name} {item.offerId && "(Members Offer)"}
                    </Text>
                  </View>

                  {/* RIGHT SIDE (prices) */}
                  <View className="flex-col items-end flex-shrink-0">
                    {item.discountedAmountInCents > 0 &&
                      !item.offerId &&
                      !item.loyaltyPointsUsed && (
                        <Text className="font-medium line-through text-gray-500">
                          {formatCurrency(
                            (item.itemPriceInCents * item.quantity) / 100
                          )}
                        </Text>
                      )}

                    <Text className="font-medium">
                      {formatCurrency(
                        ((item.itemPriceInCents -
                          item.discountedAmountInCents) *
                          item.quantity) /
                          100
                      )}
                    </Text>
                  </View>
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
              {usersMembership?.isActive && totalPrice > 0 && (
                <View className="flex-row justify-between mb-1">
                  <Text className="text-gray-500">
                    Membership Discount Included (15%)
                  </Text>
                  <Text className="font-medium">
                    - {formatCurrency(calculateMembershipDiscount())}
                  </Text>
                </View>
              )}
              <View
                className={`flex-row justify-between ${
                  usersMembership?.isActive && totalPrice > 0
                    ? "mt-2 pt-2 border-t border-gray-200"
                    : ""
                }`}
              >
                <Text className="text-gray-500">GST Included (15%)</Text>
                <Text className="font-medium">
                  {formatCurrency(calculateGST())}
                </Text>
              </View>
              <View className="flex-row justify-between mt-2 pt-2 border-t border-gray-200">
                <Text className="font-bold">Total</Text>
                <Text className="font-bold">
                  {formatCurrency(calculateTotal())}
                </Text>
              </View>
            </View>
          </View>

          {/* Pickup Time */}
          {!nextValidTime ? (
            <View className="bg-white rounded-xl shadow-sm p-5 mb-6">
              <Text className="text-red-500">
                We are currently closed for the time being. Please check our
                socials or website for more information. Sorry for any
                inconvenience caused.
              </Text>
            </View>
          ) : (
            <View className="bg-white rounded-xl shadow-sm p-4 mb-6">
              <View className=" mb-3 flex-row items-center gap-3">
                <TouchableOpacity
                  onPress={() => setEatIn(false)}
                  className={`px-5 py-3 rounded-lg ${
                    eatIn ? "bg-gray-300" : "bg-primary"
                  }`}
                >
                  <Text>Pick up</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleEatIn}
                  className={`px-5 py-3 rounded-lg  ${
                    eatIn ? "bg-primary" : "bg-gray-300"
                  }`}
                >
                  <Text>Eat in</Text>
                </TouchableOpacity>
                {showEatInError && (
                  <Text className="text-sm text-red-500">
                    Eat in not available
                  </Text>
                )}
              </View>
              {eatIn && (
                <Text className="text-sm text-gray-500 mb-2">
                  Eat ins are only available on the same day of purchase.
                </Text>
              )}

              <View className="mb-3 justify-between flex-row items-center">
                <Text className="text-lg font-medium">
                  {eatIn ? "Eat In Date" : "Pick Up Date"}
                </Text>
                {pickupNow && <Text>{formatShortDate(pickupDate)}</Text>}
              </View>
              {!(
                eatIn &&
                new Date(restaurantStatus?.unavailableUntil).getTime() >
                  nextValidTime.getTime() &&
                !restaurantStatus?.dineInAvailability
              ) && (
                <View className="flex-row items-center justify-between mb-4">
                  <Text>{eatIn ? "Eat in" : "Pickup"} as soon as possible</Text>
                  <Switch value={pickupNow} onValueChange={setPickupNow} />
                </View>
              )}

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
                      date={roundToNearest5(eatIn ? eatInDate : pickupDate)}
                      minuteInterval={5}
                      onConfirm={handleConfirm}
                      onCancel={() => setShowDatePicker(false)}
                      minimumDate={getMinTime()}
                      maximumDate={
                        eatIn
                          ? new Date(
                              (closeTime
                                ? closeTime.getTime()
                                : new Date().getTime()) -
                                30 * 60 * 1000
                            )
                          : (() => {
                              const date = new Date() // Create a new Date object
                              date.setMonth(date.getMonth() + 1)
                              return date
                            })()
                      }
                    />
                  )}

                  {Platform.OS === "android" && showDate && (
                    <DateTimePicker
                      value={eatIn ? eatInDate : pickupDate}
                      mode="date"
                      display="calendar"
                      onChange={onAndroidChangeDate}
                      minimumDate={getMinTime()}
                      maximumDate={
                        eatIn
                          ? new Date(
                              (closeTime
                                ? closeTime.getTime()
                                : new Date().getTime()) -
                                30 * 60 * 1000
                            )
                          : (() => {
                              const date = new Date() // Create a new Date object
                              date.setMonth(date.getMonth() + 1)
                              return date
                            })()
                      }
                    />
                  )}

                  {Platform.OS === "android" && showTime && (
                    <DateTimePicker
                      value={roundToNearest5(eatIn ? eatInDate : pickupDate)}
                      mode="time"
                      display="spinner"
                      minuteInterval={5}
                      onChange={onAndroidChangeTime}
                      minimumDate={getMinTime()}
                      maximumDate={
                        eatIn
                          ? new Date(
                              (closeTime
                                ? closeTime.getTime()
                                : new Date().getTime()) -
                                30 * 60 * 1000
                            )
                          : closeTime
                      }
                    />
                  )}
                  {Platform.OS === "ios" &&
                    showDoneButton &&
                    showDatePicker && (
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
          )}

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
                    onPress={handlePaymentSheet}
                    className="mt-3 bg-primary py-2 px-4 rounded-lg"
                    disabled={loadingPaymentSheet}
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
                    onPress={handlePaymentSheet}
                    className="bg-primary py-3 rounded-lg items-center"
                    disabled={loadingPaymentSheet}
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
            disabled={
              isProcessingPayment || cartItems.length === 0 || !nextValidTime
            }
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
    <StripeProvider
      publishableKey={STRIPE_PUBLISHABLE_KEY}
      urlScheme="eversweet"
    >
      <CheckoutContent />
    </StripeProvider>
  )
}
