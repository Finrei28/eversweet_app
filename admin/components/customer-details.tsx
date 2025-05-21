"use client"

import { Ionicons } from "@expo/vector-icons"
import { Linking, Text, TouchableOpacity, View } from "react-native"

type CustomerDetailsProps = {
  customer: {
    firstName: string
    lastName: string
    email: string
    phone: string | null
  }
}

export function CustomerDetails({ customer }: CustomerDetailsProps) {
  const handlePhoneCall = () => {
    Linking.openURL(`tel:${customer.phone}`)
  }

  const handleEmail = () => {
    Linking.openURL(`mailto:${customer.email}`)
  }

  return (
    <View className="bg-white mt-4 p-4">
      <Text className="text-lg font-semibold mb-4">Customer Details</Text>

      <View className="bg-gray-50 rounded-lg p-4">
        <View className="flex-row justify-between items-center mb-4">
          <View>
            <Text className="font-medium text-base">{`${customer.firstName} ${customer.lastName}`}</Text>
            {customer.email && (
              <Text className="text-gray-500 mt-1">{customer.email}</Text>
            )}
          </View>

          <View className="flex-row">
            <TouchableOpacity
              className="w-10 h-10 bg-blue-100 rounded-full items-center justify-center mr-2"
              onPress={handleEmail}
            >
              <Ionicons name="mail-outline" size={20} color="#3B82F6" />
            </TouchableOpacity>

            <TouchableOpacity
              className="w-10 h-10 bg-green-100 rounded-full items-center justify-center"
              onPress={handlePhoneCall}
            >
              <Ionicons name="call-outline" size={20} color="#10B981" />
            </TouchableOpacity>
          </View>
        </View>

        <View className="flex-row items-center pt-3 border-t border-gray-200">
          <Ionicons name="call-outline" size={16} color="#6B7280" />
          <Text className="text-gray-700 ml-2">{customer.phone}</Text>
        </View>

        <View className="flex-row items-center pt-3">
          <Ionicons name="mail-outline" size={16} color="#6B7280" />
          <Text className="text-gray-700 ml-2">{customer.email}</Text>
        </View>
      </View>
    </View>
  )
}
