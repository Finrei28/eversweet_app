import React from "react"
import { View, Text, TouchableOpacity, Image } from "react-native"
import { Feather } from "@expo/vector-icons"
import { formatCurrency } from "@/lib/formatters"
import { Offer } from "@/utils/types"
import AudienceBadge from "./audienceBadge"

type OfferCardProps = {
  offer: Offer
  /** The viewer does not qualify for this offer's audience. */
  locked: boolean
  isRedeemable: boolean
  alreadyRedeemed: boolean
  onRedeem: (offer: Offer) => void
  /** Tapping the lock — routes to the page that would unlock it. */
  onUnlock: (offer: Offer) => void
}

/** Offers can hang off a dessert, a category, or carry their own artwork. */
const offerImage = (offer: Offer) =>
  offer.image ??
  offer.dessert?.imagePath ??
  offer.category?.desserts?.[0]?.imagePath

export default function OfferCard({
  offer,
  locked,
  isRedeemable,
  alreadyRedeemed,
  onRedeem,
  onUnlock,
}: OfferCardProps) {
  const uri = offerImage(offer)

  return (
    <View className="bg-white rounded-xl shadow-sm p-4 flex-row items-center">
      <View className="w-16 h-16 mr-4">
        {uri && (
          <Image
            source={{ uri }}
            className={`w-16 h-16 rounded-lg ${locked ? "opacity-40" : ""}`}
            resizeMode="contain"
          />
        )}
        {locked && (
          <View className="absolute inset-0 items-center justify-center">
            <Feather name="lock" size={20} color="#9CA3AF" />
          </View>
        )}
      </View>

      <View className="flex-1">
        {offer.audience !== "EVERYONE" && (
          <View className="mb-1">
            <AudienceBadge audience={offer.audience} />
          </View>
        )}

        <Text
          className={`text-lg font-semibold ${
            locked ? "text-gray-400" : "text-gray-800"
          }`}
        >
          {offer.name}
        </Text>

        {offer.description && (
          <Text className={locked ? "text-gray-400" : "text-gray-600"}>
            {offer.description}
          </Text>
        )}
        {offer.dessert && (
          <Text className={locked ? "text-gray-400" : "text-gray-600"}>
            {offer.dessert.name}
          </Text>
        )}
        {offer.category && (
          <Text className={locked ? "text-gray-400" : "text-gray-600"}>
            {offer.category.name}
          </Text>
        )}

        {offer.itemPriceInCents != null ? (
          <Text
            className={`font-medium ${
              locked ? "text-gray-400" : "text-gray-800"
            }`}
          >
            {formatCurrency(offer.itemPriceInCents / 100)}
          </Text>
        ) : offer.discountAmount ? (
          <Text
            className={`font-medium ${
              locked ? "text-gray-400" : "text-primary"
            }`}
          >
            {offer.discountAmount * 100}% off
          </Text>
        ) : (
          <Text
            className={`font-medium ${
              locked ? "text-gray-400" : "text-gray-800"
            }`}
          >
            {formatCurrency((offer.dessert?.priceInCents ?? 0) / 100)}
          </Text>
        )}
      </View>

      {locked ? (
        <TouchableOpacity
          onPress={() => onUnlock(offer)}
          className="bg-primary/10 px-4 py-2 rounded-full ml-2"
        >
          <Text className="text-primary font-medium">Unlock</Text>
        </TouchableOpacity>
      ) : alreadyRedeemed ? (
        <View className="bg-gray-300 px-4 py-2 rounded-lg ml-2">
          <Text className="text-gray-700 font-bold">Redeemed</Text>
        </View>
      ) : (
        <TouchableOpacity
          onPress={() => onRedeem(offer)}
          className={`${
            !isRedeemable ? "bg-gray-300" : "bg-primary"
          } px-4 py-2 rounded-lg ml-2`}
          disabled={!isRedeemable}
        >
          <Text
            className={`${
              !isRedeemable ? "text-gray-700" : "text-white"
            } font-bold`}
          >
            Redeem
          </Text>
        </TouchableOpacity>
      )}
    </View>
  )
}
