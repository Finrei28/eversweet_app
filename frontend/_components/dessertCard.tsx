import { formatCurrency } from "@/lib/formatters"
import { Dessert, UsersMembership } from "@/utils/types"
import { Router } from "expo-router"
import React from "react"
import { View, Image, Text, TouchableOpacity } from "react-native"

type DessertCardProps = {
  dessert: Dessert
  token: string
  usersMembership: UsersMembership
  setSelectedDessert: React.Dispatch<React.SetStateAction<Dessert>>
  setModalVisible: React.Dispatch<React.SetStateAction<boolean>>
  router: Router
}

export const DessertCard = React.memo(
  ({
    dessert,
    token,
    usersMembership,
    setSelectedDessert,
    setModalVisible,
    router,
  }: DessertCardProps) => {
    return (
      <View className="flex items-center mb-6 shadow-sm bg-white rounded-2xl mx-10 pb-5">
        <Image
          source={{ uri: dessert.imagePath }}
          className="relative rounded-lg w-full h-80"
          resizeMode="cover"
        />
        <Text className="text-lg font-medium">{dessert.name}</Text>

        <TouchableOpacity
          onPress={() => {
            if (token) {
              setSelectedDessert(dessert)
              setModalVisible(true)
            } else {
              router.push("/signin")
            }
          }}
          className="bg-primary rounded-lg p-3 items-center w-1/2 mt-4 mx-auto"
        >
          {token ? (
            <View className="flex-col items-center justify-center">
              {usersMembership?.isActive ? (
                <>
                  <View className="flex-row items-center gap-1">
                    <Text className="text-red-600 line-through text-sm">
                      {formatCurrency(Number(dessert.priceInCents) / 100)}
                    </Text>
                    <Text className="text-white font-bold text-lg">
                      {formatCurrency(
                        (Number(dessert.priceInCents) * 0.85) / 100
                      )}
                    </Text>
                  </View>
                  <Text className="text-xs text-yellow-300">Member Price</Text>
                </>
              ) : (
                <Text className="text-white font-bold text-lg">
                  {formatCurrency(Number(dessert.priceInCents) / 100)}
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
  }
)
