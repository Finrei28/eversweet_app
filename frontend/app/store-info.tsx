"use client"

import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Linking,
  Alert,
} from "react-native"
import { Feather } from "@expo/vector-icons"
import CustomHeader from "@/_components/custom-header"
import { useAuth } from "@/store/authProvider"
import useFetch from "@/services/use_fetch"
import { getStoreInfo } from "@/services/api"
import BouncingLoader from "@/_components/loader"

export default function StoreInfo() {
  const { data: storeInfo, loading } = useFetch(getStoreInfo)
  const { storeHours } = useAuth()

  const openMaps = (address: string) => {
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      address,
    )}`
    if (url) {
      Linking.openURL(url)
    }
  }

  const toNZInternational = (phone: string) => {
    const cleaned = phone.replace(/[^\d+]/g, "")

    if (cleaned.startsWith("+64")) {
      return cleaned
    }

    if (cleaned.startsWith("0")) {
      return `+64${cleaned.slice(1)}`
    }

    return cleaned
  }

  const callStore = async (phoneNumber: string) => {
    const convertedPhoneNumber = toNZInternational(phoneNumber)
    const url = `tel:${convertedPhoneNumber}`

    const canOpen = await Linking.canOpenURL(url)

    if (!canOpen) {
      Alert.alert("Error", "Unable to make a call on this device.")
      return
    }

    Linking.openURL(url)
  }

  const emailStore = async (email: string) => {
    const url = `mailto:${email}`

    const canOpen = await Linking.canOpenURL(url)

    if (!canOpen) {
      Alert.alert("Error", "Unable to make an email on this device.")
      return
    }

    Linking.openURL(url)
  }

  if (loading) {
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
        <View className="mt-6 mb-4 px-1">
          <Text className="text-2xl font-bold">Store Information</Text>
        </View>
        {/* About Eversweet */}
        <View className="bg-white rounded-xl shadow-sm p-4 mb-6">
          <Text className="text-lg font-medium mb-2">About Eversweet</Text>
          <Text className="text-gray-700 mb-4">
            Eversweet is your destination for chinese desserts and boba. We
            pride ourselves on our handmade desserts and creating a warm and
            welcoming atmosphere in our store. Come visit us and enjoy our
            delicious handmade desserts
          </Text>

          <View className="flex-row items-center mb-2">
            <Feather name="globe" size={18} color="#6B7280" className="mr-2" />
            <TouchableOpacity
              onPress={() =>
                Linking.openURL(storeInfo?.website ?? "https://eversweet.co.nz")
              }
            >
              <Text className="text-primary ml-2">{storeInfo?.website}</Text>
            </TouchableOpacity>
          </View>

          <View className="flex-row items-center mb-2">
            <Feather name="mail" size={18} color="#6B7280" className="mr-2" />
            <TouchableOpacity
              onPress={() =>
                emailStore(storeInfo?.email ?? "eversweet@eversweet.co.nz")
              }
            >
              <Text className="text-primary ml-2">{storeInfo?.email}</Text>
            </TouchableOpacity>
          </View>

          <View className="flex-row items-center">
            <Feather name="phone" size={18} color="#6B7280" className="mr-2" />
            <TouchableOpacity
              onPress={() => callStore(storeInfo?.phone ?? "+6499491050")}
            >
              <Text className="text-primary ml-2">{storeInfo?.phone}</Text>
            </TouchableOpacity>
          </View>
        </View>
        {/* Store Locations */}
        <Text className="text-xl font-medium mb-3">Our Locations</Text>
        <View className="bg-white rounded-xl shadow-sm mb-10 overflow-hidden">
          {/* Store Header */}
          <View className="p-4 border-b border-gray-200">
            <View className="flex-row justify-between items-center">
              <Text className="font-bold text-lg">{storeInfo?.name}</Text>
              {storeInfo?.isOpen ? (
                <View className="bg-green-100 px-2 py-1 rounded">
                  <Text className="text-green-800 text-xs font-medium">
                    Open Now
                  </Text>
                </View>
              ) : (
                <View className="bg-red-100 px-2 py-1 rounded">
                  <Text className="text-red-800 text-xs font-medium">
                    Closed
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Store Details */}

          <View className="flex-row items-start my-2 px-4">
            <Feather
              name="map-pin"
              size={18}
              color="#6B7280"
              style={{ marginTop: 2 }}
            />
            <View className="ml-2 flex-1">
              <Text className="text-gray-700">{storeInfo?.address}</Text>
              <Text className="text-gray-700">
                {storeInfo?.city}, {storeInfo?.state} {storeInfo?.postal}
              </Text>
            </View>
          </View>

          <View className="flex-row items-center mb-2 px-4">
            <Feather name="phone" size={18} color="#6B7280" />
            <Text className="text-gray-700 ml-2">{storeInfo?.phone}</Text>
          </View>

          <View className="flex-row justify-between my-2 px-4">
            <TouchableOpacity
              onPress={() =>
                openMaps(
                  `${storeInfo?.name}, ${storeInfo?.address}, ${storeInfo?.city}, ${storeInfo?.state} ${storeInfo?.postal}`,
                )
              }
              className="bg-primary py-2 px-4 rounded-lg flex-row items-center"
            >
              <Feather name="navigation" size={16} color="white" />
              <Text className="text-white font-medium ml-1">Directions</Text>
            </TouchableOpacity>
          </View>

          {/* Store Hours (expandable) */}

          <View className="p-4 border-t border-gray-200">
            <Text className="font-medium mb-2">Store Hours</Text>
            {Object.entries(storeHours).map(([day, hours], index) => (
              <View key={index} className="flex-row justify-between py-1">
                <Text className="text-gray-700">{day}</Text>
                <Text className="text-gray-700">
                  {hours ? `${hours[0]} - ${hours[1]}` : "Closed"}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  )
}
