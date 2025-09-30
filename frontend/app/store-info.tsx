"use client"

import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Linking,
  Platform,
} from "react-native"
import { Feather } from "@expo/vector-icons"
import CustomHeader from "@/_components/custom-header"
import { parse, isAfter, isBefore } from "date-fns"
import { StoreHours } from "@/lib/businessHours"
import { useAuth } from "@/store/authProvider"

export const isStoreOpenNow = (storeHours: StoreHours): boolean => {
  const now = new Date()
  const dayName = now.toLocaleDateString("en-NZ", { weekday: "long" })
  const hours = storeHours[dayName as keyof typeof storeHours]

  if (!hours) {
    return false
  }

  const [startStr, endStr] = hours

  const start = parse(startStr, "hh:mm a", now)
  const end = parse(endStr, "hh:mm a", now)

  return isAfter(now, start) && isBefore(now, end)
}

export default function StoreInfo() {
  const { storeHours } = useAuth()

  const store = {
    name: "Eversweet",
    isOpen: isStoreOpenNow(storeHours),
    address: "5D/119 Meadowland Drive, Somerville",
    city: "Auckland",
    state: "Auckland",
    postal: "2014",
    phone: "09 949 1050",
  }

  const openMaps = (address: string) => {
    const url = Platform.select({
      ios: `maps:0,0?q=${address}`,
      android: `geo:0,0?q=${address}`,
    })

    if (url) {
      Linking.openURL(url)
    }
  }

  const callStore = (phoneNumber: string) => {
    Linking.openURL(`tel:${phoneNumber}`)
  }

  const emailStore = (email: string) => {
    Linking.openURL(`mailto:${email}`)
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
              onPress={() => Linking.openURL("https://eversweet.co.nz")}
            >
              <Text className="text-primary ml-2">www.eversweet.co.nz</Text>
            </TouchableOpacity>
          </View>

          <View className="flex-row items-center mb-2">
            <Feather name="mail" size={18} color="#6B7280" className="mr-2" />
            <TouchableOpacity
              onPress={() => emailStore("eversweet@eversweet.co.nz")}
            >
              <Text className="text-primary ml-2">
                eversweet@eversweet.co.nz
              </Text>
            </TouchableOpacity>
          </View>

          <View className="flex-row items-center">
            <Feather name="phone" size={18} color="#6B7280" className="mr-2" />
            <TouchableOpacity onPress={() => callStore("1-800-EVERSWEET")}>
              <Text className="text-primary ml-2">09 949 1050</Text>
            </TouchableOpacity>
          </View>
        </View>
        {/* Store Locations */}
        <Text className="text-xl font-medium mb-3">Our Locations</Text>
        <View className="bg-white rounded-xl shadow-sm mb-10 overflow-hidden">
          {/* Store Header */}
          <View className="p-4 border-b border-gray-200">
            <View className="flex-row justify-between items-center">
              <Text className="font-bold text-lg">{store.name}</Text>
              {store.isOpen ? (
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
              <Text className="text-gray-700">{store.address}</Text>
              <Text className="text-gray-700">
                {store.city}, {store.state} {store.postal}
              </Text>
            </View>
          </View>

          <View className="flex-row items-center mb-2 px-4">
            <Feather name="phone" size={18} color="#6B7280" />
            <Text className="text-gray-700 ml-2">{store.phone}</Text>
          </View>

          <View className="flex-row justify-between my-2 px-4">
            <TouchableOpacity
              onPress={() =>
                openMaps(
                  `${store.address}, ${store.city}, ${store.state} ${store.postal}`
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
