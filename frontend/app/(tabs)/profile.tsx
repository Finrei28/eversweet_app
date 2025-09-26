"use client"

import { View, Text, TouchableOpacity, ScrollView } from "react-native"
import type React from "react"
import PageHeader from "@/_components/pageheader"
import BouncingLoader from "@/_components/loader"
import { useRouter } from "expo-router"
import {
  MaterialIcons,
  Feather,
  MaterialCommunityIcons,
} from "@expo/vector-icons"
import { useLoyaltyStore } from "@/store/points"
import { useAuth } from "@/store/authProvider"

export default function Profile() {
  const router = useRouter()
  const { token, signOutProvider, loading } = useAuth()

  const loyaltyPoints = useLoyaltyStore((state) => state.points)

  const handleLogout = async () => {
    await signOutProvider()
    // Refresh the screen or navigate to home
    router.replace("/")
  }

  const navigateTo = (screen: string) => {
    //@ts-ignore
    router.push(screen)
  }

  const ProfileMenuItem = ({
    icon,
    title,
    onPress,
    isLast = false,
  }: {
    icon: React.ReactNode
    title: string
    onPress: () => void
    isLast?: boolean
  }) => (
    <TouchableOpacity
      onPress={onPress}
      className={`flex-row items-center justify-between p-4 ${
        !isLast ? "border-b border-gray-200" : ""
      }`}
    >
      <View className="flex-row items-center">
        <View
          className={`w-8 h-8  justify-center mr-3 ${
            title === "Membership" ? "items-start" : "items-center"
          }`}
        >
          {icon}
        </View>
        <Text className="text-lg">{title}</Text>
      </View>
      <MaterialIcons name="chevron-right" size={24} color="#9CA3AF" />
    </TouchableOpacity>
  )

  if (loading)
    return (
      <View className="flex-1 bg-background">
        <PageHeader />
        <View className="flex-1 items-center justify-center mt-32">
          <BouncingLoader />
        </View>
      </View>
    )

  if (!token)
    return (
      <View className="flex-1 bg-background">
        <PageHeader />
        <View className="flex-1 items-center justify-center mt-32">
          <Text className="text-xl font-bold text-center px-4">
            Sign in to see your profile and start earning points!
          </Text>
          <TouchableOpacity
            className="bg-primary p-3 rounded-lg w-1/3 items-center mt-5"
            onPress={() => router.push("/signin")}
          >
            <Text className="text-white text-xl">Sign in</Text>
          </TouchableOpacity>
        </View>
      </View>
    )

  return (
    <View className="flex-1 bg-background">
      <PageHeader />
      <ScrollView className="flex-1 mt-32">
        {/* Points Card */}
        <View className="mx-4 mt-6 bg-white rounded-xl shadow-md overflow-hidden">
          <View className="bg-primary p-5">
            <Text className="text-white text-lg font-medium">
              Eversweet Rewards
            </Text>
          </View>
          <View className="p-6 items-center">
            <Text className="text-gray-500 text-lg mb-2">
              Your Points Balance
            </Text>
            <Text className="font-bold text-4xl text-primary mb-2">
              {loyaltyPoints ?? 0}
            </Text>
            <TouchableOpacity
              className="bg-primary/10 px-4 py-2 rounded-full mt-2"
              onPress={() => navigateTo("/rewards")}
            >
              <Text className="text-primary font-medium">View Rewards</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Profile Options */}
        <View className="mx-4 mt-6 bg-white rounded-xl shadow-md overflow-hidden">
          <ProfileMenuItem
            icon={
              <MaterialCommunityIcons
                name="account-star-outline"
                size={24}
                color="#6B7280"
              />
            }
            title="Membership"
            onPress={() => navigateTo("/membership")}
          />
          <ProfileMenuItem
            icon={<Feather name="user" size={24} color="#6B7280" />}
            title="Account Details"
            onPress={() => navigateTo("/account-details")}
          />
          <ProfileMenuItem
            icon={<Feather name="credit-card" size={24} color="#6B7280" />}
            title="Payment Methods"
            onPress={() => navigateTo("/payment-methods")}
          />
          <ProfileMenuItem
            icon={<Feather name="shopping-bag" size={24} color="#6B7280" />}
            title="Order History"
            onPress={() => navigateTo("/order-history")}
          />
          <ProfileMenuItem
            icon={<Feather name="file-text" size={24} color="#6B7280" />}
            title="Privacy Policy"
            onPress={() => navigateTo("/privacy-policy")}
            isLast={true}
          />
        </View>

        {/* Store Info */}
        <View className="mx-4 mt-6 bg-white rounded-xl shadow-md overflow-hidden">
          <ProfileMenuItem
            icon={<Feather name="map-pin" size={24} color="#6B7280" />}
            title="Store Information"
            onPress={() => navigateTo("/store-info")}
            isLast={true}
          />
        </View>

        {/* Logout Button */}
        <View className="mx-4 mt-6 mb-8">
          <TouchableOpacity
            className="bg-white p-4 rounded-xl shadow-sm flex-row items-center justify-center"
            onPress={handleLogout}
          >
            <Feather
              name="log-out"
              size={20}
              color="#EF4444"
              style={{ marginRight: 8 }}
            />
            <Text className="text-red-500 font-medium text-lg">Log Out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  )
}
