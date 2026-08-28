"use client"

import React from "react"
import { View, Text, TouchableOpacity } from "react-native"
import { useRouter } from "expo-router"
import { Octicons } from "@expo/vector-icons"
import CustomHeader from "@/_components/custom-header"

export default function MembershipSuccessPage() {
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
          membership perks. Enjoy our exclusive offers and discounts!
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
