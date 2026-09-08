"use client"
import { View, TouchableOpacity, Platform } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useRouter, usePathname } from "expo-router"
import { Feather } from "@expo/vector-icons"
import EversweetLogo from "./eversweetLogo"

export default function CustomHeader({
  disableBack,
}: {
  disableBack?: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back()
    } else {
      router.replace("/") // fallback to home if can't go back
    }
  }

  return (
    // Top edge only. SafeAreaView defaults to all four edges, additively, so
    // this bar was also padding itself by the *bottom* inset — 34pt of dead
    // secondary-coloured space under the logo on any device with a home
    // indicator, and the navigation bar height on Android.
    //
    // The class here used to be `-pb-safe-offset-16`, which reads as an attempt
    // to cancel that. It cannot: `pb-safe-offset-16` means "bottom inset plus
    // 64pt" in NativeWind, and padding has no negative form for the leading `-`
    // to mean anything. So it either did nothing or added 64pt more. Naming the
    // edge is what actually removes the inset.
    <SafeAreaView className="bg-secondary">
      <View
        className={`flex-row items-center justify-center bg-secondary ${
          Platform.OS === "android" ? "py-3" : "py-3"
        }`}
      >
        {/* Centre - Logo. The only child in the flex flow, so it centres on the
            whole header rather than on the space left beside the back button,
            which is what an in-flow arrow would have done. */}
        {/* <EversweetLogo height={28} /> */}

        {/* Left - Back button, when not on a main tab. Absolutely positioned so
            it overlays the bar without shifting the logo off centre. */}
        {!pathname.includes("(tabs)") && (
          <TouchableOpacity
            onPress={handleBack}
            className="p-2 absolute left-4"
            disabled={disableBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={8}
          >
            <Feather name="arrow-left" size={24} color="#000" />
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  )
}
