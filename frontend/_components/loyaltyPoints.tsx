import { getUserLoyaltyPoints } from "@/services/api"
import useFetch from "@/services/use_fetch"
import { Text, View } from "react-native"

export default function LoyaltyPoints() {
  const {
    data: loyaltyPoints,
    error,
    loading,
  } = useFetch(() => getUserLoyaltyPoints())
  return (
    <View className="flex flex-row justify-center items-center gap-3 my-6">
      <Text className="font-bold text-4xl ">Points:</Text>
      <Text className="font-bold text-4xl text-primary">{loyaltyPoints}</Text>
    </View>
  )
}
