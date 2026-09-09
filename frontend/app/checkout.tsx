"use client"

import { useState, useEffect, useMemo, useRef } from "react"
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
import { useRouter } from "expo-router"
import * as Crypto from "expo-crypto"
import { Feather } from "@expo/vector-icons"
import CustomHeader from "@/_components/custom-header"
import BouncingLoader from "@/_components/loader"
import { StripeProvider, useStripe } from "@stripe/stripe-react-native"
import {
  getSavedCards,
  createPaymentIntent,
  checkPaymentStatus,
  DuplicateOrderError,
} from "@/services/stripe-api"
import { useCartStore, whenCartWritesSettle } from "@/store/cart"
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker"
import {
  createOrder,
  checkOrderStatus,
  getEstimatedPickUpTime,
} from "@/services/api"
import DateTimePickerModal from "react-native-modal-datetime-picker"
import { isDayOff, isOutsideBusinessHours } from "@/lib/businessHours"
import { useLoyaltyStore } from "@/store/points"
import {
  getLastOrderTime,
  getNextValidPickupTime,
  getOpenCloseTime,
  LAST_ORDER_OFFSET_MINUTES,
} from "@/lib/checkoutHelpers"
import { useAuth } from "@/store/authProvider"
import {
  formatCurrency,
  formatDayMonthTime,
  formatShortDate,
  formatTime,
  formatWeekdayDate,
  roundToNearest5,
} from "@/lib/formatters"
import { addNZMonths, NZ_TIMEZONE, withNZTimeOfDay } from "@/lib/nzTime"
import Toast from "react-native-toast-message"
import { useRestaurantStatusQuery } from "@/services/queries"
import { openPaymentSheetForSetup } from "@/utils/stripeMethod"
import { getErrorMessage } from "@/utils/getError"
import { TickAnimation } from "@/_components/tickAnimation"

// Your Stripe publishable key - should be in environment variables
const STRIPE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY!

// Helper functions

function CheckoutContent() {
  const router = useRouter()
  const { confirmPayment, initPaymentSheet, presentPaymentSheet } = useStripe()
  const { token, authLoading, dataLoading, usersMembership, tradingCalendar } =
    useAuth()
  const { data: restaurantStatus, isLoading: loadingRestaurantStatus } =
    useRestaurantStatusQuery()
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
  const eatInErrorTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (eatInErrorTimeout.current) clearTimeout(eatInErrorTimeout.current)
    },
    [],
  )
  const [paymentSuccess, setPaymentSuccess] = useState(false)
  const [creatingOrderLoading, setCreatingOrderLoading] = useState(false)
  const [loading, setLoading] = useState(false)

  // Cart items and total
  const cartOperations = useCartStore((state) => state.cartOperations)
  const cartItems = useCartStore((state) => state.items)
  const getTotalMembershipDiscount = useCartStore(
    (state) => state.getTotalMembershipDiscount,
  )
  const getTotalItems = useCartStore((state) => state.getTotalItems)
  const getTotalCost = useCartStore((state) => state.getTotalCost)
  const processOrder = useCartStore((state) => state.processOrder)
  // Derived straight from the subscribed items rather than through the store
  // getter, so the dependency is the array itself.
  const totalItems = useMemo(
    () => cartItems.reduce((acc, item) => acc + item.quantity, 0),
    [cartItems],
  )

  // getTotalCost reduces over every item and its customisations. It reads the
  // store through get(), so cartItems is the real trigger even though the
  // callback never names it — which is what the lint rule is objecting to.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const totalPrice = useMemo(() => getTotalCost(), [getTotalCost, cartItems])

  // Pickup time state

  const [eatIn, setEatIn] = useState(false)
  const [eatInDate, setEatInDate] = useState<Date | null>(null)
  const [pickupNow, setPickupNow] = useState(true)
  const [pickupDate, setPickupDate] = useState<Date | null>(null)
  // Read inside the pickup-time effect without making it a dependency, so
  // toggling "as soon as possible" doesn't trigger a refetch.
  const pickupNowRef = useRef(pickupNow)
  pickupNowRef.current = pickupNow

  const [estimatedReadyTime, setEstimatedReadyTime] = useState<Date | null>(
    null,
  )
  const [nextValidTime, setNextValidTime] = useState<Date | null>(null)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [showDoneButton, setShowDoneButton] = useState(false)
  const [showDate, setShowDate] = useState(false)
  const [showTime, setShowTime] = useState(false)
  // Resolves the New Zealand calendar day several times over through
  // date-fns-tz, each with its own Intl work — too expensive to repeat on every
  // render of a screen this size.
  const { closeTime } = useMemo(
    () => getOpenCloseTime(eatIn ? eatInDate : pickupDate, tradingCalendar),
    [eatIn, eatInDate, pickupDate, tradingCalendar],
  )

  // Eat-in has to be ordered further ahead of closing than a pickup does.
  const lastOrderOffsetMinutes = eatIn
    ? LAST_ORDER_OFFSET_MINUTES.eatIn
    : LAST_ORDER_OFFSET_MINUTES.pickup

  // Fetch saved cards when component mounts

  // Once per mount. Keying this on `cartOperations === 0` meant removing an
  // item — which bumps the counter to 1 and back to 0 — refetched the whole
  // cart over the network and flashed the loader, even though the store had
  // already applied the removal locally.
  const hasLoadedCart = useRef(false)
  useEffect(() => {
    if (hasLoadedCart.current || cartOperations !== 0) return
    hasLoadedCart.current = true

    const getNewItems = async () => {
      setLoading(true)
      // Anything still in the air first. fetchCart replaces the list outright,
      // so arriving here mid-write meant reading back a cart the server had
      // not finished being told about.
      await whenCartWritesSettle()
      await useCartStore.getState().fetchCart()
      setLoading(false)
    }
    getNewItems()
  }, [cartOperations])

  useEffect(() => {
    // Depends on token: it arrives from AuthProvider a tick after mount, and
    // on an empty dep list the cards were never fetched, leaving loadingCards
    // true and the screen stuck on its loader.
    if (token) {
      fetchSavedCards()
    }
  }, [token])

  useEffect(() => {
    // The trading calendar starts as AuthProvider's fallback hours with no
    // days off, and is replaced once the real ones load, so the first valid
    // pickup time has to be recomputed rather than settled on mount against
    // the placeholder.
    let cancelled = false

    const init = async () => {
      try {
        // Fetched here rather than inside the helper so a failure can be
        // absorbed: nextValidTime is null only when the week holds no trading
        // hours at all, never because one request did not come back. Falling
        // back to now still leaves the slot bounded by the store's hours, and
        // the refresh interval below picks up the real estimate on its next
        // pass.
        const earliestReadyTime = await getEstimatedPickUpTime(
          totalItems,
        ).catch((error) => {
          console.error("Failed to fetch the estimated pickup time", error)
          return new Date()
        })
        // Functional form so the effect never has to read the current value:
        // that read was a stale closure, and listing it as a dependency would
        // restart the lookup every time the estimate moved. Returning `prev`
        // unchanged keeps the identity stable, so nothing re-renders.
        setEstimatedReadyTime((prev) =>
          prev?.getTime() === earliestReadyTime.getTime()
            ? prev
            : earliestReadyTime,
        )

        const next = await getNextValidPickupTime(
          new Date(),
          totalItems,
          tradingCalendar,
          { earliestReadyTime, lastOrderOffsetMinutes },
        )
        if (cancelled) return

        setNextValidTime(next)
        // Only steer the chosen time while it is still derived ("as soon as
        // possible"). A time the customer chose themselves must not be moved.
        if (pickupNowRef.current) {
          if (eatIn) setEatInDate(next)
          else setPickupDate(next)
        }
      } catch (error) {
        console.error("Failed to work out the next valid pickup time", error)
      }
    }

    init()

    return () => {
      cancelled = true
    }
    // Depends on eatIn: switching mode changes the cut-off, which can move the
    // soonest bookable slot to the next trading day. On totalItems because a
    // larger cart takes the kitchen longer, which can do the same.
  }, [tradingCalendar, eatIn, lastOrderOffsetMinutes, totalItems])

  useEffect(() => {
    let cancelled = false

    const interval = setInterval(async () => {
      // Nothing on this screen is visible while the app is backgrounded, so
      // polling then just burns the customer's data and battery.
      if (AppState.currentState !== "active") return

      try {
        const now = new Date()
        const earliestReadyTime = await getEstimatedPickUpTime(totalItems)
        setEstimatedReadyTime((prev) =>
          prev?.getTime() === earliestReadyTime.getTime()
            ? prev
            : earliestReadyTime,
        )
        // Hand the estimate over rather than letting this refetch it: the two
        // calls hit the same endpoint with the same argument.
        const nextValidPickupTime = await getNextValidPickupTime(
          now,
          totalItems,
          tradingCalendar,
          {
            earliestReadyTime: earliestReadyTime,
            lastOrderOffsetMinutes,
          },
        )
        if (cancelled) return

        setNextValidTime(nextValidPickupTime)

        // Only drag a chosen time forward when the kitchen can no longer make
        // it by then.
        setPickupDate((prev) =>
          prev && earliestReadyTime.getTime() > prev.getTime()
            ? nextValidPickupTime
            : prev,
        )
      } catch (error) {
        console.error("Failed to refresh the pickup time", error)
      }
    }, 60 * 1000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [totalItems, tradingCalendar, lastOrderOffsetMinutes])

  // Assigned on every render, just below the handler's definition.
  const handleAppStateChangeRef = useRef<(state: AppStateStatus) => void>(
    () => {},
  )

  useEffect(() => {
    // Called through a ref so the listener is attached once and still runs the
    // latest closure. Re-subscribing whenever the payment intent changed was
    // only ever a way of keeping that closure fresh.
    const subscription = AppState.addEventListener("change", (next) =>
      handleAppStateChangeRef.current(next),
    )

    return () => {
      subscription.remove()
    }
  }, [])

  const handlePaymentSheet = async () => {
    setLoadingPaymentSheet(true)
    await openPaymentSheetForSetup(
      { initPaymentSheet, presentPaymentSheet },
      fetchSavedCards,
      usersMembership ? usersMembership.isActive : false,
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

  handleAppStateChangeRef.current = handleAppStateChange

  /**
   * Blocks the checkout on the customer's answer, so the charge waits for it.
   * Deliberately not cancellable: dismissing it without choosing would fall
   * through to a second charge, which is the whole thing being prevented.
   *
   * The local cart is left alone either way — it is only evidence that a
   * response went missing, not proof, and throwing away someone's order to
   * act on a guess is worse than asking them again next time.
   */
  const confirmRepeatOrder = (error: DuplicateOrderError) =>
    new Promise<boolean>((resolve) => {
      const placedAt = new Date(error.existingOrder.createdAt).getTime()
      const minutes = Math.max(1, Math.round((Date.now() - placedAt) / 60000))

      Alert.alert(
        "You may have already ordered this",
        `Order #${error.existingOrder.tempOrderId} for the same items was placed ${minutes} minute${
          minutes === 1 ? "" : "s"
        } ago. Charge your card again for another one?`,
        [
          {
            text: "View my orders",
            style: "cancel",
            onPress: () => {
              resolve(false)
              router.replace("/orders")
            },
          },
          {
            text: "Order again",
            style: "destructive",
            onPress: () => resolve(true),
          },
        ],
        { cancelable: false },
      )
    })

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
            ],
          )
        }
      } else if (status.pending) {
        // Payment is still processing
        setIsProcessingPayment(true)
      } else {
        // Payment failed
        Alert.alert(
          "Payment Failed",
          "Your payment could not be processed. Please try again.",
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
        ],
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
          ],
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
        ],
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
      console.error(getErrorMessage(error, "Failed to fetch saved cards"))
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
      // Shown in store time: the customer is choosing a slot at an Auckland
      // counter, and the picker beside this label is displaying the same clock.
      return formatDayMonthTime(eatIn && eatInDate ? eatInDate : pickupDate)
    }
  }

  const alertTimeChange = (date: Date | null) => {
    if (date === null) {
      Alert.alert(
        "Invalid Time",
        "Please select a valid pickup time during our business hours.",
      )
      // Without this the function carries on and stacks a second alert on top:
      // getOpenCloseTime(null) reports no opening hours, so the branch below
      // fires "Sorry, we are closed on that day..." as well.
      return
    }

    // Named by date, not weekday. A day off is a one-off closure, so "we are
    // open 12:00 PM to 10:00 PM on a Tuesday" would be actively misleading —
    // the store keeps those hours on a Tuesday, just not on this one.
    if (isDayOff(date, tradingCalendar.daysOff)) {
      Alert.alert(
        "We're closed that day",
        `We are closed on ${formatWeekdayDate(date)}. Please choose another day.`,
      )
      return
    }

    const { openTime, closeTime, dayName } = getOpenCloseTime(
      date,
      tradingCalendar,
    )

    // No hours for that weekday at all, so quoting hours is impossible anyway.
    if (!openTime || !closeTime) {
      Alert.alert(
        "We're closed that day",
        `We are not open on ${formatWeekdayDate(date)}. Please choose another day.`,
      )
      return
    }

    Alert.alert(
      "Sorry, we are closed at that time",
      `Please choose a time during store hours. We are open ${formatTime(
        openTime,
      )} to ${formatTime(closeTime)} on a ${dayName}.`,
    )
  }

  const setChosenDate = (date: Date) => {
    if (eatIn) setEatInDate(date)
    else setPickupDate(date)
  }

  type PickOutcome =
    | { status: "none" } // nothing valid all week — nothing to commit
    | { status: "moved"; time: Date } // had to shift to the nearest open slot
    | { status: "exact" } // the choice was already valid

  /**
   * Shared by all three pickers: check what the customer chose against the
   * store's hours and tell them if it cannot stand. The caller commits, so the
   * time picker can keep its own day-preserving merge.
   */
  const validatePickedTime = async (picked: Date): Promise<PickOutcome> => {
    const validTime = await getNextValidPickupTime(
      picked,
      getTotalItems(),
      tradingCalendar,
      {
        earliestReadyTime: estimatedReadyTime ?? undefined,
        lastOrderOffsetMinutes,
      },
    )

    if (!validTime) {
      // No valid slot exists, so leave the current selection alone. This used
      // to write nextValidTime, which is Date | null — only the "we are
      // closed" render guard kept a null out of eatInDate/pickupDate.
      alertTimeChange(null)
      return { status: "none" }
    }

    if (validTime.getTime() !== picked.getTime()) {
      alertTimeChange(picked)
      return { status: "moved", time: validTime }
    }

    return { status: "exact" }
  }

  const handleConfirm = async (date: Date) => {
    const outcome = await validatePickedTime(date)

    // On "moved" this used to commit nextValidTime — the soonest slot from now
    // — rather than validTime, the slot nearest what was actually picked. Both
    // Android handlers already used validTime; iOS now agrees with them.
    if (outcome.status === "moved") setChosenDate(outcome.time)
    else if (outcome.status === "exact") setChosenDate(date)

    setShowDatePicker(false)
  }

  const onAndroidChangeDate = async (
    event: DateTimePickerEvent,
    selectedDate?: Date,
  ) => {
    if (event.type === "dismissed" || !selectedDate) {
      setShowDate(false)
      return
    }

    const outcome = await validatePickedTime(selectedDate)

    if (outcome.status === "moved") setChosenDate(outcome.time)
    else if (outcome.status === "exact") setChosenDate(selectedDate)

    setShowDate(false)
    if (event.type === "set") setShowTime(true)
  }

  const onAndroidChangeTime = async (
    event: DateTimePickerEvent,
    selectedTime?: Date,
  ) => {
    if (event.type === "dismissed" || !selectedTime) {
      setShowTime(false)
      return
    }

    const outcome = await validatePickedTime(selectedTime)

    if (outcome.status === "moved") {
      setChosenDate(outcome.time)
    } else if (outcome.status === "exact") {
      // Keep the day already chosen and take only the time from this picker,
      // resolved in store time — setHours would have applied the device's.
      const baseDate = eatIn ? eatInDate : pickupDate
      setChosenDate(withNZTimeOfDay(baseDate ?? new Date(), selectedTime))
    }

    if (event.type === "set") setShowTime(false)
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

  // Extracted from the total, not added to it. New Zealand prices include
  // GST, so the 15% rate applies to the ex-GST amount: $23.00 inclusive
  // holds $3.00 of GST, because $20.00 x 1.15 = $23.00. Taking 15% of the
  // inclusive price gave $3.45 and overstated the line by 15%.
  const gstAmount = (totalPrice * 3) / 23 / 100

  const orderTotal = totalPrice / 100

  // The heaviest of the three: per item it applies the membership discount and
  // the promo (which allocates dates) and reduces over the customisations.
  // Reads the store through get(), as above.
  const membershipDiscount = useMemo(
    () => getTotalMembershipDiscount(usersMembership) / 100,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getTotalMembershipDiscount, usersMembership, cartItems],
  )

  const handlePlaceOrder = async () => {
    if (!nextValidTime) {
      Alert.alert(
        "We're closed for the time being, sorry for any inconvenience caused",
      )
      return
    }

    const totalAmount = Math.round(getTotalCost())

    // Resolved once and reused for both the guards and the order itself, so
    // what gets validated is exactly what gets sent.
    const requestedPickUpTime = pickupNow
      ? nextValidTime
      : eatIn
        ? (eatInDate ?? nextValidTime)
        : (pickupDate ?? nextValidTime)

    // A day off closes the store outright, so it is worth its own message —
    // "we are closed at that time" would read as though another time that day
    // would do.
    if (isDayOff(requestedPickUpTime, tradingCalendar.daysOff)) {
      Alert.alert(
        "We're closed that day",
        "We are not open on your selected date. Please choose another day.",
      )
      return
    }

    // Checked whether or not the customer picked the time by hand. This was
    // gated on `pickupNow`, so for a hand-picked slot the answer was worked out
    // and then thrown away: a day off added while the screen was open, or a
    // slot that fell out of hours as the evening wore on, went through.
    if (isOutsideBusinessHours(requestedPickUpTime, tradingCalendar)) {
      Alert.alert(
        pickupNow
          ? "We're closed or are not open yet. Please pick a suitable pick up time."
          : "We're closed at that time. Please pick a suitable pick up time.",
      )
      return
    }

    if (cartItems?.length === 0) {
      Alert.alert("Your cart is empty")
      return
    }

    setIsProcessingPayment(true)

    try {
      // Create order object

      // One key for this checkout attempt, minted before the card is charged
      // so every send of this order carries the same one. A later attempt
      // gets a fresh key, because that is a genuinely new order.
      const orderIdempotencyKey = Crypto.randomUUID()

      const paymentMethodId = totalAmount > 0 ? selectedCardId : null

      let paymentIntentId: string | null = null

      if (totalAmount > 0) {
        if (!selectedCardId || showAddCard) {
          Alert.alert("Please select a payment method or add a new card")
          return
        }

        // Get payment intent client secret from your server
        let intent
        try {
          intent = await createPaymentIntent(totalAmount, "nzd", selectedCardId, {
            pickUpTime: requestedPickUpTime,
            eatIn,
          })
        } catch (error) {
          // The server spotted an identical order placed moments ago — most
          // likely this one, with its response lost on the way back. Asking
          // is the last chance to avoid charging the same card twice for it.
          if (!(error instanceof DuplicateOrderError)) throw error

          if (!(await confirmRepeatOrder(error))) return

          intent = await createPaymentIntent(totalAmount, "nzd", selectedCardId, {
            pickUpTime: requestedPickUpTime,
            eatIn,
            confirmDuplicate: true,
          })
        }

        const { clientSecret, paymentIntentId: id } = intent

        paymentIntentId = id
        // Track it in state too, so handleAppStateChange can recover the payment
        // if the app is backgrounded mid-confirmation.
        setPaymentIntentId(id)

        // Confirm the payment with Stripe
        const { error, paymentIntent } = await confirmPayment(clientSecret, {
          paymentMethodType: "Card",
          paymentMethodData: {
            paymentMethodId: selectedCardId,
          },
        })

        if (error) {
          console.error("Stripe error:", {
            message: error.message,
            code: error.code,
            declineCode: error.declineCode,
          })

          throw new Error(
            error.message ?? "Your card was declined. Please try another one.",
          )
        }

        if (paymentIntent.status !== "Succeeded") {
          throw new Error(`Payment failed with status: ${paymentIntent.status}`)
        }

        paymentIntentId = paymentIntent.id
      }

      // Payment succeeded, now create the order in the database
      setPaymentSuccess(true)
      // Start order creation immediately
      const orderPromise =
        totalAmount > 0
          ? createOrder(
              paymentMethodId,
              pickupNow,
              requestedPickUpTime,
              eatIn,
              paymentIntentId,
              orderIdempotencyKey,
            )
          : createOrder(
              null,
              pickupNow,
              requestedPickUpTime,
              eatIn,
              null,
              orderIdempotencyKey,
            )

      // Delay showing loading UI
      const loadingTimeout = setTimeout(() => {
        setCreatingOrderLoading(true)
      }, 1500) // enough time for tick animation to feel smooth

      const orderResponse = await orderPromise

      // Stop delayed loading if it hasn’t shown yet
      clearTimeout(loadingTimeout)
      if (!orderResponse) {
        throw new Error("Failed to create order")
      }
      setCreatingOrderLoading(false)
      setOrderInProgress(orderResponse.id)

      // If total amount is 0, refresh loyalty points
      if (totalAmount === 0) {
        useLoyaltyStore.getState().fetchPoints()
      }

      // Clear cart
      processOrder()

      router.replace("/orders")
    } catch (error) {
      setPaymentSuccess(false)
      setCreatingOrderLoading(false)
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
          ],
        )
      } else {
        console.error(getErrorMessage(error))
        Toast.show({
          type: "error",
          text1: `${getErrorMessage(error)}`,
          position: "bottom",
          visibilityTime: undefined,
          autoHide: false,
          bottomOffset: 90,
        })
      }
    } finally {
      setIsProcessingPayment(false)
    }
  }

  const handleEatIn = () => {
    if (!nextValidTime) return

    const unavailableUntil = restaurantStatus?.unavailableUntil
    const unavailableUntilDate = unavailableUntil
      ? new Date(unavailableUntil)
      : null
    const unavailableUntilTime = unavailableUntilDate?.getTime() ?? 0

    if (
      !restaurantStatus?.dineInAvailability &&
      !restaurantStatus?.unavailableUntil
    ) {
      setShowEatInError(true)
      // Tracked so leaving the screen mid-countdown cannot fire a setState on
      // an unmounted component, and so repeated taps restart the 3s rather
      // than stacking timers that each clear the message.
      if (eatInErrorTimeout.current) clearTimeout(eatInErrorTimeout.current)
      eatInErrorTimeout.current = setTimeout(
        () => setShowEatInError(false),
        3000,
      )
      return
    } else if (
      !restaurantStatus?.dineInAvailability &&
      unavailableUntilDate &&
      unavailableUntilTime > nextValidTime.getTime()
    ) {
      setEatInDate(unavailableUntilDate)
    } else {
      setEatInDate(nextValidTime)
    }
    const shouldDisableEatInNow = unavailableUntilDate
      ? unavailableUntilTime > nextValidTime.getTime()
      : !restaurantStatus?.dineInAvailability

    if (shouldDisableEatInNow) {
      setPickupNow(false)
    }

    setEatIn(true)
  }

  const getMinTime = () => {
    const minTime = nextValidTime ?? new Date()
    const unavailableUntilDate = restaurantStatus?.unavailableUntil
      ? new Date(restaurantStatus.unavailableUntil)
      : null

    return eatIn &&
      !restaurantStatus?.dineInAvailability &&
      unavailableUntilDate &&
      nextValidTime &&
      unavailableUntilDate > nextValidTime
      ? roundToNearest5(unavailableUntilDate)
      : roundToNearest5(minTime)
  }

  // The latest slot on the selected day: 30 minutes before close for eat-in,
  // 10 for pickup. This bound was rebuilt inline at each of the three pickers
  // and only ever applied the eat-in offset.
  //
  // No closing time means no upper bound. Falling back to Date.now() here made
  // the bound 30 minutes in the *past*, so it landed before minimumDate — which
  // happens whenever the selected date falls on a day the store is shut,
  // reachable via restaurantStatus.unavailableUntil.
  const lastOrderTime = useMemo(
    () =>
      closeTime
        ? getLastOrderTime(closeTime, lastOrderOffsetMinutes)
        : undefined,
    [closeTime, lastOrderOffsetMinutes],
  )

  // How far ahead a pickup can be booked, stepped on the store's calendar.
  const pickupMaxDate = useMemo(() => addNZMonths(new Date(), 1), [])

  const getMaxTime = () => (eatIn ? lastOrderTime : pickupMaxDate)

  if (creatingOrderLoading) {
    return (
      <View className="flex-1 bg-background">
        <CustomHeader />
        <View className="flex-1 items-center justify-center">
          <View className="flex-row items-center justify-center gap-2">
            <Text className="text-primary font-semibold">
              Sending your order to the kitchen
            </Text>
            <BouncingLoader />
          </View>
        </View>
      </View>
    )
  }

  if (
    authLoading ||
    dataLoading ||
    loadingCards ||
    cartOperations > 0 ||
    loading ||
    loadingRestaurantStatus
  ) {
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
                      {item.dessert.name} {item.offerId && "(Offer)"}
                    </Text>
                  </View>

                  {/* RIGHT SIDE (prices) */}
                  <View className="flex-col items-end flex-shrink-0">
                    {!item.loyaltyPointsUsed && (
                      <Text className="font-medium line-through text-gray-500">
                        {formatCurrency(
                          (item.itemPriceInCents * item.quantity) / 100,
                        )}
                      </Text>
                    )}

                    <Text className="font-medium">
                      {formatCurrency(
                        ((item.itemPriceInCents -
                          item.discountedAmountInCents) *
                          item.quantity) /
                          100,
                      )}
                    </Text>
                  </View>
                </View>
                {item.customisations.map((customisation) => {
                  const customisationPriceAfterDiscount =
                    (customisation.priceInCents -
                      customisation.discountedAmountInCents) *
                    customisation.quantity *
                    item.quantity

                  return (
                    <View
                      key={customisation.id}
                      className="flex flex-row items-center justify-between"
                    >
                      <Text className="text-sm">{`${
                        customisation.quantity === 0 ? `- ` : `+ `
                      } ${customisation.name} ${
                        customisation.quantity > 1
                          ? `x${customisation.quantity}`
                          : ``
                      }`}</Text>
                      {customisation.quantity > 0 && (
                        <Text className="text-sm text-muted-foreground">
                          {formatCurrency(
                            customisationPriceAfterDiscount / 100,
                          )}
                        </Text>
                      )}
                    </View>
                  )
                })}
              </View>
            ))}

            <View className="mt-4 pt-3 border-t border-gray-200">
              {usersMembership?.isActive && totalPrice > 0 && (
                <View className="flex-row justify-between mb-1">
                  <Text className="text-gray-500">
                    Membership Discount Included
                  </Text>
                  <Text className="font-medium">
                    - {formatCurrency(membershipDiscount)}
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
                  {formatCurrency(gstAmount)}
                </Text>
              </View>
              <View className="flex-row justify-between mt-2 pt-2 border-t border-gray-200">
                <Text className="font-bold">Total</Text>
                <Text className="font-bold">
                  {formatCurrency(orderTotal)}
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
                {pickupNow && pickupDate && (
                  <Text>{formatShortDate(pickupDate)}</Text>
                )}
              </View>
              {!(
                eatIn &&
                restaurantStatus?.unavailableUntil &&
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
                      // Show store time: pickup slots are validated against
                      // Auckland opening hours, so the wheel has to agree.
                      timeZoneName={NZ_TIMEZONE}
                      date={roundToNearest5(
                        eatIn
                          ? (eatInDate ?? nextValidTime)
                          : (pickupDate ?? nextValidTime),
                      )}
                      minuteInterval={5}
                      onConfirm={handleConfirm}
                      onCancel={() => setShowDatePicker(false)}
                      minimumDate={getMinTime()}
                      maximumDate={getMaxTime()}
                    />
                  )}

                  {Platform.OS === "android" && showDate && (
                    <DateTimePicker
                      value={
                        eatIn
                          ? (eatInDate ?? nextValidTime)
                          : (pickupDate ?? nextValidTime)
                      }
                      mode="date"
                      display="calendar"
                      timeZoneName={NZ_TIMEZONE}
                      onChange={onAndroidChangeDate}
                      minimumDate={getMinTime()}
                      maximumDate={getMaxTime()}
                    />
                  )}

                  {Platform.OS === "android" && showTime && (
                    <DateTimePicker
                      value={roundToNearest5(
                        eatIn
                          ? (eatInDate ?? nextValidTime)
                          : (pickupDate ?? nextValidTime),
                      )}
                      mode="time"
                      display="spinner"
                      minuteInterval={5}
                      timeZoneName={NZ_TIMEZONE}
                      onChange={onAndroidChangeTime}
                      minimumDate={getMinTime()}
                      // The time wheel is bounded by the day's cut-off in both
                      // modes; pickup used to run right up to closing.
                      maximumDate={lastOrderTime}
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
                  ? "Remember to have your notifications turned on to receive real time changes to your order(s) status."
                  : "Please have the apps notifications turned on to receive real time changes to your order(s) status or arrive at your selected time to pick up your order."}
              </Text>
            </View>
          )}

          {/* Payment Method */}
          {totalPrice > 0 && (
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
                    {loadingPaymentSheet ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text className="text-white font-medium">
                        Add New Card
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {/* Place Order Button */}
          <View className="relative">
            <TouchableOpacity
              onPress={handlePlaceOrder}
              className="bg-primary h-14 rounded-lg items-center justify-center"
              disabled={
                isProcessingPayment || cartItems.length === 0 || !nextValidTime
              }
              activeOpacity={0.8}
            >
              {!paymentSuccess && (
                <>
                  {isProcessingPayment ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text className="text-white font-bold text-lg">
                      Place Order
                    </Text>
                  )}
                </>
              )}
            </TouchableOpacity>

            {paymentSuccess && (
              <View className="absolute inset-0 items-center justify-center">
                <TickAnimation />
              </View>
            )}
          </View>

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
