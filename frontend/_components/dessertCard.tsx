import { formatCurrency } from "@/lib/formatters"
import { calculateBestDiscountedPrice } from "@/lib/priceHelper"
import { Dessert, UsersMembership } from "@/utils/types"
import { Router } from "expo-router"
import React, { useMemo } from "react"
import { View, Text, TouchableOpacity } from "react-native"
import { CachedImage } from "@/_components/cachedImage"

type DessertCardProps = {
  dessert: Dessert
  token: string | null
  usersMembership: UsersMembership | null
  setSelectedDessert: React.Dispatch<React.SetStateAction<Dessert | null>>
  setModalVisible: React.Dispatch<React.SetStateAction<boolean>>
  router: Router
  currency: "cents" | "points"
  loyaltyPoints?: number
  /**
   * Membership is still loading, so the discount can't be worked out yet.
   * Shows a placeholder rather than the undiscounted price, which would flash
   * a member the higher figure and then drop it a moment later.
   */
  membershipPending?: boolean
}

export const DessertCard = React.memo(
  ({
    dessert,
    token,
    usersMembership,
    setSelectedDessert,
    setModalVisible,
    router,
    currency = "cents",
    loyaltyPoints,
    membershipPending = false,
  }: DessertCardProps) => {
    const dessertPriceInCentsAfterDiscount = useMemo(() => {
      return calculateBestDiscountedPrice(dessert, usersMembership)
    }, [dessert, usersMembership])
    return (
      <View className="flex items-center mb-6 shadow-sm bg-white rounded-2xl mx-10 pb-5 p-1">
        <CachedImage
          uri={dessert.imagePath}
          className="relative rounded-lg w-full h-72"
          alt={dessert.name}
          resizeMode="cover"
          recyclingKey={dessert.id}
        />

        <Text className="text-lg font-medium my-2 text-center">
          {dessert.name}
        </Text>

        <TouchableOpacity
          onPress={() => {
            if (token) {
              setSelectedDessert(dessert)
              setModalVisible(true)
            } else {
              router.push("/signin")
            }
          }}
          disabled={
            loyaltyPoints ? loyaltyPoints < dessert.priceInLoyaltyPoints : false
          }
          className="bg-primary rounded-lg p-3 items-center w-1/2  mx-auto"
        >
          {token ? (
            <View className="flex-col items-center justify-center">
              {currency === "cents" && membershipPending ? (
                <View className="h-6 w-16 rounded bg-white/40" />
              ) : currency === "cents" ? (
                <>
                  {usersMembership?.isActive || dessert.promo?.isActive ? (
                    <>
                      <View className="flex-row items-center gap-1">
                        <Text className="text-red-600 line-through text-sm">
                          {formatCurrency(Number(dessert.priceInCents) / 100)}
                        </Text>
                        <Text className="text-white font-bold text-lg">
                          {formatCurrency(
                            Number(dessertPriceInCentsAfterDiscount) / 100,
                          )}
                        </Text>
                      </View>
                      <Text className="text-xs text-yellow-300">
                        {usersMembership?.isActive
                          ? "Member Price"
                          : "Special Offer"}
                      </Text>
                    </>
                  ) : (
                    <Text className="text-white font-bold text-lg">
                      {formatCurrency(
                        Number(dessertPriceInCentsAfterDiscount) / 100,
                      )}
                    </Text>
                  )}
                </>
              ) : (
                <Text className="text-white font-bold text-lg">
                  {dessert.priceInLoyaltyPoints} points
                </Text>
              )}
            </View>
          ) : (
            <Text style={{ color: "#FFFFFF", fontWeight: "bold" }}>
              Sign In
            </Text>
          )}
        </TouchableOpacity>
      </View>
    )
  },
)

DessertCard.displayName = "DessertCard"
