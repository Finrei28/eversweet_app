"use client"
import { View, TouchableOpacity, Image } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useRouter, usePathname } from "expo-router"
import { Feather } from "@expo/vector-icons"
import { Platform } from "react-native"

export default function CustomHeader() {
  const router = useRouter()
  const pathname = usePathname()

  const handleBack = () => {
    router.back()
  }

  return (
    <SafeAreaView className={`bg-secondary -pb-safe-offset-16`}>
      <View
        className={`flex-row items-center justify-center bg-secondary ${
          Platform.OS === "android" ? "py-6" : ""
        }`}
      >
        {/* Left side - Back button if not on main tabs */}
        {!pathname.includes("(tabs)") && (
          <TouchableOpacity
            onPress={handleBack}
            className="p-1 absolute left-6"
          >
            <Feather name="arrow-left" size={24} color="#000" />
          </TouchableOpacity>
        )}

        {/* Center - Logo */}
        <View className="flex-1 items-center justify-center ">
          <Image
            source={{ uri: process.env.EXPO_PUBLIC_LOGO_URL }}
            className="w-40 h-12  mx-auto resize-contain"
            // Fallback if image doesn't load
            defaultSource={{ uri: process.env.EXPO_PUBLIC_LOGO_URL }}
          />
        </View>
      </View>
    </SafeAreaView>
  )
}
