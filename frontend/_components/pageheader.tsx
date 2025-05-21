import { View, Image } from "react-native"
import { Platform } from "react-native"

export default function PageHeader() {
  return (
    <View
      className={`absolute top-0 left-0 right-0 z-10 w-full bg-secondary items-center justify-center ${
        Platform.OS === "ios" ? "h-32" : "h-24"
      }`}
    >
      <Image
        source={{ uri: process.env.EXPO_PUBLIC_LOGO_URL }}
        className={`w-40 h-16 ${Platform.OS === "ios" ? "mt-14" : ""}`}
      />
    </View>
  )
}
