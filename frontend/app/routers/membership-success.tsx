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
import { useFocusEffect, useNavigation, useRouter } from "expo-router"
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
import { formatCurrency } from "@/lib/formatters"

export default function membershipSuccessPage() {
  const router = useRouter()

  const handleGoToHome = () => {
    router.back() // replace with your home route
  }

  return (
    <View className="flex-1 bg-background">
      <CustomHeader />
      <View className="flex-1 justify-center items-center bg-white p-6">
        <Octicons
          name="check-circle"
          size={80}
          color="#10B981"
          className="mb-6"
        />
        <Text className="text-2xl font-bold text-center mb-2">
          Membership Activated!
        </Text>
        <Text className="text-gray-600 text-center mb-8">
          Huge thanks for joining our membership! You now have access to all
          membership perks. Enjoy exclusive offers and discounts!
        </Text>

        <TouchableOpacity
          onPress={handleGoToHome}
          className="bg-primary px-6 py-3 rounded-lg"
        >
          <Text className="text-white font-medium text-lg">Go back</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}
