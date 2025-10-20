"use client"

import { useState, useEffect } from "react"
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
  ActivityIndicator,
} from "react-native"
import { useRouter } from "expo-router"
import { Feather } from "@expo/vector-icons"
import CustomHeader from "@/_components/custom-header"
import {
  StripeProvider,
  CardField,
  useStripe,
  type CardFieldInput,
  CardForm,
} from "@stripe/stripe-react-native"
import {
  getSavedCards,
  saveCard,
  removeCard,
  createSetupIntent,
  getCurrentSubscriptionPaymentMethodID,
} from "@/services/stripe-api"
import { getUserProfile } from "@/services/api"
import { useAuth } from "@/store/authProvider"
import BouncingLoader from "@/_components/loader"
import { openPaymentSheetForSetup } from "@/utils/stripeMethod"
import Toast from "react-native-toast-message"

// Your Stripe publishable key - should be in environment variables

export default function PaymentMethodsStripe() {
  return (
    <StripeProvider
      publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY!}
      urlScheme="eversweet"
    >
      <PaymentMethodsContent />
    </StripeProvider>
  )
}

function PaymentMethodsContent() {
  const router = useRouter()
  const { createPaymentMethod, initPaymentSheet, presentPaymentSheet } =
    useStripe()
  const { token, loading: loadingToken } = useAuth()
  const [savedCards, setSavedCards] = useState<any[]>([])
  const [loadingCards, setLoadingCards] = useState(true)
  const [loadingPaymentSheet, setLoadingPaymentSheet] = useState(false)
  const [paymentMethodId, setPaymentMethodId] = useState<string | null>(null)

  // Fetch saved cards when component mounts
  useEffect(() => {
    if (!token && !loadingToken) {
      router.push("/signin")
    } else {
      fetchSavedCards()
    }
  }, [token, loadingToken])

  const fetchSavedCards = async () => {
    try {
      setLoadingCards(true)
      const cards = await getSavedCards()
      const id = await getCurrentSubscriptionPaymentMethodID()
      setPaymentMethodId(id)
      setSavedCards(cards)
    } catch (error) {
      console.error("Failed to fetch saved cards:", error)
      Alert.alert("Error", "Failed to load your saved payment methods.")
    } finally {
      setLoadingCards(false)
    }
  }

  const handlePaymentSheet = async () => {
    setLoadingPaymentSheet(true)
    await openPaymentSheetForSetup(
      { initPaymentSheet, presentPaymentSheet },
      fetchSavedCards
    )
    setLoadingPaymentSheet(false)
  }

  const handleDeleteCard = async (paymentMethodId: string) => {
    Alert.alert(
      "Delete Payment Method",
      "Are you sure you want to delete this payment method?",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await removeCard(paymentMethodId)
              // Refresh the list after deletion
              fetchSavedCards()
            } catch (error) {
              console.error("Failed to delete payment method:", error)
              Alert.alert("Error", "Failed to delete payment method.")
            }
          },
        },
      ]
    )
  }

  const handleSamePaymentCard = () => {
    Toast.show({
      type: "error",
      text1: `That card is currently active`,
      position: "bottom",
      visibilityTime: 3000,
      autoHide: true,
      bottomOffset: 60,
      props: {
        text1NumberOfLines: 0,
        text2NumberOfLines: 0, // allow wrapping
      },
    })
  } //show a pop up or a toast indicating the card is currently active hence cannot be deleted

  const formatCardBrand = (brand: string) => {
    return brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase()
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

  return (
    <View className="flex-1 bg-background">
      <CustomHeader />
      <ScrollView className="flex-1 px-4">
        <View className="flex-row justify-between items-center mt-6 mb-4 px-1">
          <Text className="text-2xl font-bold">Payment Methods</Text>

          <TouchableOpacity
            onPress={handlePaymentSheet}
            className="flex-row items-center"
            disabled={loadingPaymentSheet}
          >
            <Feather name="plus" size={18} color="#6B7280" />
            <Text className="ml-1 text-gray-500">Add</Text>
          </TouchableOpacity>
        </View>

        {/* Add New Card Form */}
        {/* {showAddCard && (
          <View className="bg-white rounded-xl shadow-sm p-4 mb-6">
            <View className="flex-row justify-between items-center mb-4">
              <Text className="text-lg font-medium">Add New Card</Text>
              <TouchableOpacity onPress={() => setShowAddCard(false)}>
                <Feather name="x" size={25} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <View className="mb-4">
              <Text className="text-gray-500 mb-2">Card Information</Text>
              <CardForm
                onFormComplete={(cardDetails) => setCardDetails(cardDetails)}
                style={{ width: "100%", height: 200 }} // taller container
                cardStyle={{
                  backgroundColor: "#fff",
                  textColor: "#000",
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: "#E5E7EB",
                }}
                dangerouslyGetFullCardDetails={false}
              />
            </View>

            <TouchableOpacity
              onPress={handleAddCard}
              className="bg-primary py-3 rounded-lg items-center"
              disabled={processingCard || !cardDetails?.complete}
            >
              {processingCard ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text className="text-white font-medium">Add Card</Text>
              )}
            </TouchableOpacity>
          </View>
        )} */}
        <>
          <TouchableOpacity
            onPress={handlePaymentSheet}
            disabled={loadingPaymentSheet}
          >
            <View className="bg-white rounded-xl shadow-sm p-6 items-center mb-6">
              <Feather name="credit-card" size={48} color="#D1D5DB" />
              <Text className="mt-2 text-gray-500 text-center">
                {savedCards.length > 0
                  ? "Add another payment method"
                  : "Add a payment method"}
              </Text>
            </View>
          </TouchableOpacity>
        </>

        {/* Saved Payment Methods */}
        {loadingCards ? (
          <View className="bg-white rounded-xl shadow-sm p-6 items-center mb-6">
            <ActivityIndicator size="large" color="#e6aa6b" />
            <Text className="mt-2 text-gray-500">
              Loading payment methods...
            </Text>
          </View>
        ) : savedCards.length > 0 ? (
          <>
            <View className="bg-white rounded-xl shadow-sm overflow-hidden mb-6">
              {savedCards.map((card, index) => (
                <View
                  key={card.id}
                  className={`p-4 ${
                    index < savedCards.length - 1
                      ? "border-b border-gray-200"
                      : ""
                  }`}
                >
                  <View className="flex-row justify-between items-center">
                    <View className="flex-row items-center">
                      <Feather name="credit-card" size={24} color="#6B7280" />
                      <View className="ml-3">
                        <Text className="font-medium">
                          {formatCardBrand(card.card.brand)} ••••{" "}
                          {card.card.last4}
                        </Text>
                        <Text className="text-gray-500 text-sm">
                          Expires {card.card.exp_month}/
                          {card.card.exp_year.toString().slice(-2)}
                        </Text>
                      </View>
                    </View>
                    {paymentMethodId === card.id ? (
                      <TouchableOpacity onPress={() => handleSamePaymentCard()}>
                        <Feather name="trash-2" size={18} color="#9CA3AF" />
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        onPress={() => handleDeleteCard(card.id)}
                      >
                        <Feather name="trash-2" size={18} color="#EF4444" />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              ))}
            </View>
          </>
        ) : (
          <View></View>
        )}

        {/* Stripe Information */}
        <View className="mb-6">
          <View className="flex-row items-center justify-center mb-2">
            <Feather name="lock" size={14} color="#6B7280" />
            <Text className="text-gray-500 text-sm ml-1">
              Payments secured by Stripe
            </Text>
          </View>
          <Text className="text-gray-400 text-xs text-center">
            Your payment information is processed securely. We do not store your
            credit card details.
          </Text>
        </View>
      </ScrollView>
    </View>
  )
}
