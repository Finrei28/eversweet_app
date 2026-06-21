import { formatCurrency } from "@/lib/formatters"
import { showOffers } from "@/services/api"
import { Offer, Offers, UsersMembership } from "@/utils/types"
import { useFocusEffect } from "expo-router"
import { useCallback, useState } from "react"
import {
  View,
  Text,
  ActivityIndicator,
  TouchableOpacity,
  Image,
} from "react-native"
import OfferModal from "./offerModal"

type ShowOffersProps = {
  usersMembership: UsersMembership
}

export default function ShowOffers({ usersMembership }: ShowOffersProps) {
  const [offers, setOffers] = useState<Offers>([])
  const [loadingOffers, setLoadingoffers] = useState(true)
  const [offerModal, setOfferModal] = useState(false)
  const [selectedOffer, setSelectedOffer] = useState<Offer | null>(null)

  const getOffers = async () => {
    setLoadingoffers(true)
    const currentOffers = await showOffers()
    setOffers(currentOffers ?? [])
    setLoadingoffers(false)
  }

  useFocusEffect(
    useCallback(() => {
      if (usersMembership.isActive) {
        // fetch or load offers here
        getOffers()
      }
    }, [usersMembership]),
  )

  const handleRedeemOffer = (offer: Offer) => {
    setSelectedOffer(offer)
    if (!offer) {
      return
    }
    setOfferModal(true)
  }

  if (!usersMembership.isActive) {
    return null
  }

  if (loadingOffers) {
    return (
      <View className="bg-white rounded-xl shadow-sm p-6 items-center">
        <ActivityIndicator size="large" color="#e6aa6b" />
        <Text className="mt-2 text-gray-500">Loading offers...</Text>
      </View>
    )
  }

  if (offers.length === 0) {
    return
  }
  return (
    <View className="gap-2">
      {offers.map((offer) => {
        const redemption = offer.redemptions[0] // always the membership's redemption for this offer, if it exists

        // check if offer is redeemable based on redemption status and offer requirements
        const usedCount = redemption ? redemption.used : 0
        const isRedeemable =
          usedCount < offer.limit &&
          (offer.requirements.length === 0 ||
            redemption?.status === "AVAILABLE") &&
          usersMembership.paymentStatus === "SUCCESS"
        const alreadyRedeemed = usedCount >= offer.limit
        const itemPriceInCents = offer.itemPriceInCents ?? null
        const discountAmount = offer.discountAmount ?? null

        return (
          <View
            key={offer.id}
            className="bg-white rounded-xl shadow-sm p-4 flex-row justify-between items-center"
          >
            {/* Left side: Text */}
            <Image
              source={{
                uri: offer.image
                  ? offer.image
                  : (offer.dessert?.imagePath ??
                    offer.category?.desserts?.[0]?.imagePath),
              }}
              className="w-16 h-16 rounded-lg mr-4"
              resizeMode="contain"
            />
            <View className="flex-1">
              <Text className="text-lg font-semibold text-gray-800">
                {offer.name}
              </Text>
              {offer.description && (
                <Text className="text-gray-600">{offer.description}</Text>
              )}
              {offer.dessert && (
                <Text className="text-gray-600">{offer.dessert.name}</Text>
              )}
              {offer.category && (
                <Text className="text-gray-600">{offer.category.name}</Text>
              )}
              {offer.itemPriceInCents != null ? (
                <Text className="text-gray-800 font-medium">
                  {formatCurrency(offer.itemPriceInCents / 100)}
                </Text>
              ) : (
                <Text className="text-primary font-medium">
                  {offer.discountAmount! * 100}% off
                </Text>
              )}
            </View>

            {/* Right side: Button */}
            {!alreadyRedeemed ? (
              <TouchableOpacity
                onPress={() => handleRedeemOffer(offer)}
                className={`${!isRedeemable ? "bg-gray-300" : "bg-primary"} px-4 py-2 rounded-lg`}
                disabled={!isRedeemable}
              >
                <Text
                  className={`${!isRedeemable ? "text-gray-700" : "text-white"} font-bold`}
                >
                  Redeem
                </Text>
              </TouchableOpacity>
            ) : (
              <View className="bg-gray-300 px-4 py-2 rounded-lg">
                <Text className="text-gray-700 font-bold">Redeemed</Text>
              </View>
            )}
          </View>
        )
      })}
      {offerModal && selectedOffer && (
        <OfferModal
          offer={selectedOffer}
          itemPriceInCents={selectedOffer.itemPriceInCents}
          discountAmount={selectedOffer.discountAmount}
          offerModal={offerModal}
          setOfferModal={setOfferModal}
          refetchOffers={getOffers}
        />
      )}
    </View>
  )
}
