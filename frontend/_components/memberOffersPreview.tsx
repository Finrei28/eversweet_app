import React, { useMemo } from "react"
import { View, Text, TouchableOpacity } from "react-native"
import { useRouter } from "expo-router"
import { useOffersQuery } from "@/services/queries"
import { Offers } from "@/utils/types"
import { CachedImage } from "@/_components/cachedImage"

/**
 * A short strip of the member's offers on the Membership page, linking through
 * to the Offers page where they are actually redeemed.
 *
 * Deliberately not interactive beyond the link: two places that can redeem the
 * same offer is two places to keep in step.
 */
const PREVIEW_LIMIT = 2

export default function MemberOffersPreview() {
  const router = useRouter()

  // Shares its cache with the Offers page rather than fetching the same
  // payload again: this used to refetch on every focus, so bouncing between
  // Membership and Offers issued the request three times over.
  const { data, isLoading: loading } = useOffersQuery()

  const offers: Offers = useMemo(
    () => (data?.offers ?? []).filter((o) => o.audience === "MEMBERS"),
    [data],
  )

  if (loading) {
    return (
      <View className="bg-white rounded-xl shadow-sm p-4 mb-6">
        <View className="flex-row justify-between items-center">
          <View className="h-5 w-36 bg-gray-200 rounded" />
          <View className="h-8 w-20 bg-gray-200 rounded-full" />
        </View>

        <View className="mt-3">
          {[0, 1].map((row) => (
            <View
              key={row}
              className={`flex-row items-center py-2 ${
                row === 0 ? "border-b border-gray-100" : ""
              }`}
            >
              <View className="w-12 h-12 rounded-md mr-3 bg-gray-200" />
              <View className="h-4 flex-1 bg-gray-200 rounded" />
            </View>
          ))}
        </View>
      </View>
    )
  }

  return (
    <View className="bg-white rounded-xl shadow-sm p-4 mb-6">
      <View className="flex-row justify-between items-center">
        <Text className="text-lg font-medium">Your Member Offers</Text>
        <TouchableOpacity
          className="bg-primary/10 px-4 py-2 rounded-full"
          onPress={() => router.push("/offers")}
        >
          <Text className="text-primary font-medium">View all</Text>
        </TouchableOpacity>
      </View>

      {offers.length === 0 ? (
        <Text className="text-gray-500 text-sm mt-3">
          No member offers available right now.
        </Text>
      ) : (
        <View className="mt-3">
          {offers.slice(0, PREVIEW_LIMIT).map((offer, index) => {
            const uri =
              offer.image ??
              offer.dessert?.imagePath ??
              offer.category?.desserts?.[0]?.imagePath

            return (
              <View
                key={offer.id}
                className={`flex-row items-center py-2 ${
                  index < Math.min(offers.length, PREVIEW_LIMIT) - 1
                    ? "border-b border-gray-100"
                    : ""
                }`}
              >
                {uri && (
                  <CachedImage
                    uri={uri}
                    className="w-12 h-12 rounded-md mr-3"
                    resizeMode="contain"
                  />
                )}
                <Text className="flex-1 font-medium" numberOfLines={1}>
                  {offer.name}
                </Text>
              </View>
            )
          })}

          {offers.length > PREVIEW_LIMIT && (
            <Text className="text-gray-500 text-sm mt-2">
              +{offers.length - PREVIEW_LIMIT} more
            </Text>
          )}
        </View>
      )}
    </View>
  )
}
