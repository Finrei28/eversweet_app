"use client"

import React, { useState, useCallback } from "react"
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
  ActivityIndicator,
} from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { Feather, Octicons } from "@expo/vector-icons"
import Checkbox from "expo-checkbox"
import CustomHeader from "@/_components/custom-header"
import {
  createMembership,
  getMembershipDetails,
  getSavedCards,
  pollMembershipStatus,
} from "@/services/stripe-api"
import { useAuth } from "@/store/authProvider"
import BouncingLoader from "@/_components/loader"
import { MembershipDetails } from "@/utils/types"
import { formatCurrency, formatShortDate } from "@/lib/formatters"
import ShowOffers from "@/_components/showOffersToMembers"
import CancelMembershipModal from "@/_components/cancelMembershipModal"
import { openPaymentSheetForSetup } from "@/utils/stripeMethod"
import { StripeProvider, useStripe } from "@stripe/stripe-react-native"

export default function MembershipPage() {
  return (
    <StripeProvider
      publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY!}
      urlScheme="eversweet"
    >
      <MembershipContent />
    </StripeProvider>
  )
}

function MembershipContent() {
  const router = useRouter()
  const {
    token,
    loading: loadingToken,
    usersMembership,
    refetchUsersMembership,
  } = useAuth()
  const { initPaymentSheet, presentPaymentSheet } = useStripe()
  const [savedCards, setSavedCards] = useState<any[]>([])
  const [loadingCards, setLoadingCards] = useState(true)
  const [showAddCard, setShowAddCard] = useState(false)
  const [agree, setAgree] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [isProcessingPayment, setIsProcessingPayment] = useState(false)
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [cancelMembership, setCancelMembership] = useState(false)
  const [loadingMembershipDetails, setLoadingMembershipDetails] =
    useState<boolean>(true)
  const [membershipDetails, setMembershipDetails] =
    useState<MembershipDetails | null>(null)
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [loadingPaymentSheet, setLoadingPaymentSheet] = useState(false)

  // Fetch saved cards when component mounts
  useFocusEffect(
    useCallback(() => {
      if (!token && !loadingToken) {
        router.push("/signin")
      } else {
        refetchUsersMembership()
        fetchSavedCards()
        getMembershipDetail()
      }
    }, [token, loadingToken])
  )

  const getMembershipDetail = async () => {
    setLoadingMembershipDetails(true)
    const membershipDetails = await getMembershipDetails()
    setMembershipDetails(membershipDetails)
    setLoadingMembershipDetails(false)
  }

  const handlePaymentSheet = async () => {
    setLoadingPaymentSheet(true)
    await openPaymentSheetForSetup(
      { initPaymentSheet, presentPaymentSheet },
      fetchSavedCards
    )
    setLoadingPaymentSheet(false)
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

  const pollUsersMembershipStatus = async (
    interval = 2000, // 2 seconds
    timeout = 30000 // 30 seconds max
  ) => {
    const startTime = Date.now()

    return new Promise<void>((resolve, reject) => {
      const checkStatus = async () => {
        try {
          const membershipStatus = await pollMembershipStatus() // fetch latest membership
          if (membershipStatus?.isActive) {
            resolve() // membership active, stop polling
            return
          } else if (membershipStatus.paymentStatus === "FAILED") {
            reject(
              new Error("Payment failed, please check your bank and try again.")
            )
          } else if (Date.now() - startTime > timeout) {
            reject(
              new Error("Membership activation timed out. Please try again.")
            )
            return
          }

          setTimeout(checkStatus, interval) // try again after interval
        } catch (err: any) {
          reject(err)
        }
      }

      checkStatus()
    })
  }

  const handleJoinMembership = async () => {
    setPaymentError(null)
    setSubmitted(true)
    if (!agree) {
      Alert.alert("Please agree to the Terms & Privacy to continue.")
      return
    }
    try {
      setIsProcessingPayment(true)
      await createMembership(selectedCardId, membershipDetails.stripePriceId)
      await pollUsersMembershipStatus()
      router.push("/routers/membership-success")
    } catch (error) {
      Alert.alert("Payment Failed", error.message)
      setPaymentError(error.message)
    } finally {
      setIsProcessingPayment(false)
    }
  }

  if (loadingToken || loadingCards || loadingMembershipDetails) {
    return (
      <View className="flex-1 bg-background">
        <CustomHeader />
        <View className="flex-1 items-center justify-center">
          <BouncingLoader />
        </View>
      </View>
    )
  }

  return (
    <View className="flex-1 bg-background">
      <CustomHeader />
      <ScrollView className="flex-1 px-4">
        <View className="flex-row justify-between items-center mt-6 mb-4 px-1">
          <Text className="text-2xl font-bold">Membership</Text>
        </View>

        {/* Membership details */}
        <View className="bg-white rounded-xl shadow-sm p-4 mb-6">
          <View className="mb-3">
            <View className="flex-row items-center">
              <Text className="text-lg font-medium">Your Membership: </Text>
              {usersMembership?.isActive ? (
                <Octicons name="check-circle" size={18} color="#10B981" />
              ) : (
                <Octicons name="x-circle" size={18} color="#EF4444" />
              )}
            </View>

            <Text className="text-gray-500 text-sm mt-1">
              Enjoy exclusive perks with your subscription
            </Text>
          </View>

          {/* Current Plan */}
          <View className="flex-row justify-between items-center mb-4">
            <View>
              <Text className="text-xl font-semibold">Membership Plan</Text>
              <Text className="text-gray-500">
                {formatCurrency(membershipDetails.price / 100)} / month
              </Text>
              {usersMembership?.isActive && usersMembership?.cancel && (
                <Text className="text-gray-500">
                  Expires on {formatShortDate(usersMembership.endDate)}
                </Text>
              )}
            </View>
            {usersMembership?.isActive && !usersMembership?.cancel && (
              <TouchableOpacity
                onPress={() => setCancelMembership(true)}
                className="bg-red-500 px-2 py-1 rounded-lg"
              >
                <Text className="text-white">Cancel</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Benefits list */}
          <View className="space-y-3">
            <View className="flex-row items-center">
              <Feather name="check-circle" size={18} color="#10B981" />
              <Text className="ml-2 text-gray-700">
                free weekly Mochi Series bowl ($9.99)
              </Text>
            </View>
            <View className="flex-row items-center">
              <Feather name="check-circle" size={18} color="#10B981" />
              <Text className="ml-2 text-gray-700">
                15% discount on all listed items
              </Text>
            </View>
            <View className="flex-row items-center">
              <Feather name="check-circle" size={18} color="#10B981" />
              <Text className="ml-2 text-gray-700">Earn 2x loyalty points</Text>
            </View>
            <View className="flex-row items-center">
              <Feather name="check-circle" size={18} color="#10B981" />
              <Text className="ml-2 text-gray-700">
                Exclusive member offers
              </Text>
            </View>
            <View className="flex-row items-center">
              <Feather name="check-circle" size={18} color="#10B981" />
              <Text className="ml-2 text-gray-700">Cancel anytime</Text>
            </View>
            <View className="flex-row items-center">
              <Text className=" text-gray-700">
                More benefits to come in the future...
              </Text>
            </View>
          </View>
        </View>

        {/* Payment Method */}
        {usersMembership && usersMembership.isActive ? (
          <View>
            <Text className="text-xl font-medium mb-2 px-1">
              Member Offers:
            </Text>
            <ShowOffers usersMembership={usersMembership} />
          </View>
        ) : (
          <View>
            <View className="bg-white rounded-xl shadow-sm p-4">
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

            <View className="p-4 my-4">
              <View className="flex-row items-center">
                <Checkbox
                  value={agree}
                  onValueChange={setAgree}
                  color={agree ? "#e6aa6b" : ""} // red when checked
                />
                <Text className="flex-1 ml-8">
                  I agree to the{" "}
                  <Text
                    className="text-blue-600 underline"
                    onPress={() => open("https://example.com/terms")}
                  >
                    Terms & Conditions
                  </Text>{" "}
                  and{" "}
                  <Text
                    className="text-blue-600 underline"
                    onPress={() => open("https://example.com/privacy")}
                  >
                    Privacy Policy
                  </Text>
                  .
                </Text>
              </View>

              {submitted && !agree && (
                <Text className="text-red-600 text-center mt-2">
                  You must agree before continuing.
                </Text>
              )}
              {paymentError && (
                <Text className="text-red-600 text-center mt-2">
                  Payment error {paymentError}
                </Text>
              )}
            </View>

            {/* Place Order Button */}
            {!showAddCard && (
              <TouchableOpacity
                onPress={handleJoinMembership}
                className="bg-primary py-4 rounded-lg items-center"
                disabled={isProcessingPayment}
              >
                {isProcessingPayment ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text className="text-white font-bold text-lg">
                    Join Membership
                  </Text>
                )}
              </TouchableOpacity>
            )}

            {/* Stripe Information */}
            <View className="mt-6 mb-10">
              <View className="flex-row items-center justify-center mb-2">
                <Feather name="lock" size={14} color="#6B7280" />
                <Text className="text-gray-500 text-sm ml-1">
                  Payments secured by Stripe
                </Text>
              </View>
              <Text className="text-gray-400 text-xs text-center">
                Your payment information is processed securely. We do not store
                your credit card details.
              </Text>
            </View>
          </View>
        )}
      </ScrollView>
      {cancelMembership && (
        <CancelMembershipModal
          modalVisible={cancelMembership}
          setModalVisible={setCancelMembership}
        />
      )}
    </View>
  )
}
