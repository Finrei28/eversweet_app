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
} from "@stripe/stripe-react-native"
import { getSavedCards, saveCard, removeCard } from "@/services/stripe-api"
import { getUserProfile } from "@/services/api"
import { useAuth } from "@/store/authProvider"

// Your Stripe publishable key - should be in environment variables

export default function PaymentMethodsStripe() {
  return (
    <StripeProvider
      publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY!}
    >
      <PaymentMethodsContent />
    </StripeProvider>
  )
}

function PaymentMethodsContent() {
  const router = useRouter()
  const { createPaymentMethod } = useStripe()
  const { token, loading: loadingToken } = useAuth()
  const [savedCards, setSavedCards] = useState<any[]>([])
  const [loadingCards, setLoadingCards] = useState(true)
  const [showAddCard, setShowAddCard] = useState(false)
  const [cardDetails, setCardDetails] = useState<CardFieldInput.Details | null>(
    null
  )
  const [processingCard, setProcessingCard] = useState(false)

  // Fetch saved cards when component mounts
  useEffect(() => {
    if (token) {
      fetchSavedCards()
    }
  }, [token])

  const fetchSavedCards = async () => {
    try {
      setLoadingCards(true)
      const cards = await getSavedCards()
      setSavedCards(cards)
    } catch (error) {
      console.error("Failed to fetch saved cards:", error)
      Alert.alert("Error", "Failed to load your saved payment methods.")
    } finally {
      setLoadingCards(false)
    }
  }

  const handleAddCard = async () => {
    if (!cardDetails?.complete) {
      Alert.alert("Error", "Please enter complete card information.")
      return
    }

    setProcessingCard(true)

    try {
      // Create a payment method with the card details
      const user = await getUserProfile()
      const { paymentMethod, error: pmError } = await createPaymentMethod({
        paymentMethodType: "Card",
        paymentMethodData: {
          billingDetails: {
            // You can add billing details here if collected from the user
            email: user.email,
            name: `${user.firstName} ${user.lastName}`,
          },
        },
      })
      if (pmError) {
        throw new Error(pmError.message)
      }

      if (!paymentMethod) {
        throw new Error("Failed to create payment method")
      }

      // Save the card to the customer's account
      await saveCard(paymentMethod.id)

      // Refresh the list of saved cards
      await fetchSavedCards()

      // Reset form and hide add card section
      setShowAddCard(false)
      setCardDetails(null)

      Alert.alert("Success", "Card added successfully.")
    } catch (error: any) {
      console.error("Error adding card:", error)
      Alert.alert(
        "Error",
        error.message || "Failed to add card. Please try again."
      )
    } finally {
      setProcessingCard(false)
    }
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

  const formatCardBrand = (brand: string) => {
    return brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase()
  }

  if (loadingToken) {
    return (
      <View className="flex-1 bg-background">
        <CustomHeader />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#e6aa6b" />
        </View>
      </View>
    )
  }

  if (!token) {
    router.replace("/signin")
    return null
  }

  return (
    <View className="flex-1 bg-background">
      <CustomHeader />
      <ScrollView className="flex-1 px-4">
        <View className="flex-row justify-between items-center mt-6 mb-4">
          <Text className="text-2xl font-bold">Payment Methods</Text>
          {!showAddCard && (
            <TouchableOpacity
              onPress={() => setShowAddCard(true)}
              className="flex-row items-center"
            >
              <Feather name="plus" size={18} color="#6B7280" />
              <Text className="ml-1 text-gray-500">Add</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Add New Card Form */}
        {showAddCard && (
          <View className="bg-white rounded-xl shadow-sm p-4 mb-6">
            <View className="flex-row justify-between items-center mb-4">
              <Text className="text-lg font-medium">Add New Card</Text>
              <TouchableOpacity onPress={() => setShowAddCard(false)}>
                <Feather name="x" size={20} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <View className="mb-4">
              <Text className="text-gray-500 mb-2">Card Information</Text>
              <CardField
                postalCodeEnabled={false}
                placeholders={{
                  number: "4242 4242 4242 4242",
                  expiration: "MM/YY",
                  cvc: "CVC",
                }}
                cardStyle={{
                  backgroundColor: "#FFFFFF",
                  textColor: "#000000",
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: "#E5E7EB",
                }}
                style={{
                  width: "100%",
                  height: 50,
                  marginVertical: 8,
                }}
                onCardChange={(cardDetails) => {
                  setCardDetails(cardDetails)
                }}
              />
            </View>

            {/* <View className="flex-row items-center justify-between mb-4">
              <Text>Save card for future use</Text>
              <Switch
                value={saveCardForFuture}
                onValueChange={setSaveCardForFuture}
                trackColor={{ false: "#D1D5DB", true: "#10B981" }}
                thumbColor="#FFFFFF"
              />
            </View> */}

            <TouchableOpacity
              onPress={handleAddCard}
              className="bg-primary py-3 rounded-lg items-center"
              disabled={processingCard || !cardDetails?.complete}
            >
              {processingCard ? (
                <ActivityIndicator size="small" color="#e6aa6b" />
              ) : (
                <Text className="text-white font-medium">Add Card</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Saved Payment Methods */}
        {loadingCards ? (
          <View className="bg-white rounded-xl shadow-sm p-6 items-center mb-6">
            <ActivityIndicator size="large" color="#e6aa6b" />
            <Text className="mt-2 text-gray-500">
              Loading payment methods...
            </Text>
          </View>
        ) : savedCards.length > 0 ? (
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
                  <TouchableOpacity onPress={() => handleDeleteCard(card.id)}>
                    <Feather name="trash-2" size={18} color="#EF4444" />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        ) : (
          <View className="bg-white rounded-xl shadow-sm p-6 items-center mb-6">
            <Feather name="credit-card" size={48} color="#D1D5DB" />
            <Text className="mt-2 text-gray-500 text-center">
              No payment methods added yet
            </Text>
          </View>
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
