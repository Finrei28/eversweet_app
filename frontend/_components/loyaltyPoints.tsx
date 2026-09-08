import { getUserLoyaltyPoints } from "@/services/api"
import useFetch from "@/services/use_fetch"
import { ActivityIndicator, Text, View } from "react-native"

export default function LoyaltyPoints() {
  const {
    data: loyaltyPoints,
    error,
    loading,
  } = useFetch(() => getUserLoyaltyPoints())

  // The fetch state was discarded before, so a request still in flight and one
  // that failed both rendered as an empty space beside "Points:", which reads
  // as a balance of nothing rather than as "not loaded".
  return (
    <View className="flex flex-row justify-center items-center gap-3 my-6">
      <Text className="font-bold text-4xl ">Points:</Text>
      {loading ? (
        <ActivityIndicator size="small" color="#e6aa6b" />
      ) : error ? (
        <Text className="text-base text-gray-500">Unavailable</Text>
      ) : (
        <Text className="font-bold text-4xl text-primary">
          {loyaltyPoints ?? 0}
        </Text>
      )}
    </View>
  )
}
