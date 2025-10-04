import React, { useState, useEffect } from "react"
import {
  Text,
  View,
  Image,
  StatusBar,
  FlatList,
  TouchableOpacity,
  ScrollView,
} from "react-native"
import { homepageCards } from "@/_components/_homepageContent"
import PageHeader from "@/_components/pageheader"
import { SplashScreen, Stack, useRouter } from "expo-router"
import ViewCart from "@/_components/viewCart"
import { useCartStore } from "@/store/cart"
import { FontAwesome } from "@expo/vector-icons"
import useFetch from "@/services/use_fetch"
import { getPromotions } from "@/services/api"

// This is needed for the order history screen to properly import FontAwesome
export { FontAwesome }

SplashScreen.preventAutoHideAsync()

export default function Index() {
  const router = useRouter()
  const cartItems = useCartStore((state) => state.items)
  const { data: promotions, loading: loadingPromotions } = useFetch(() =>
    getPromotions()
  )
  useEffect(() => {
    if (!loadingPromotions) {
      SplashScreen.hideAsync()
    }
  }, [loadingPromotions])
  return (
    <View className="flex-1 bg-background">
      <PageHeader />
      <ScrollView>
        {promotions?.length > 0 && (
          <>
            <Text className="mt-36 text-4xl font-bold text-primary p-5 text-center">
              Promotions
            </Text>

            {promotions.map((promotion) => (
              <View
                key={promotion.id}
                className="flex justify-center bg-white mx-10 py-5 my-4 gap-5 rounded-2xl shadow-sm"
              >
                <Text className="text-primary font-bold text-2xl text-center">
                  {promotion.title}
                </Text>
                <Text className="text-gray-500 font-semibold text-md text-center px-6">
                  {promotion.description}
                </Text>
                {promotion.imagePath && (
                  <Image
                    source={{ uri: promotion.imagePath }}
                    className="w-full bg-white h-80 mx-auto object-cover rounded-lg mt-2"
                    resizeMode="contain"
                    alt={promotion.title}
                    accessibilityLabel={promotion.title}
                    accessibilityHint={`This is an item of ${promotion.title}`}
                    accessibilityRole="image"
                    accessibilityState={{ selected: true }}
                    accessibilityLabelledBy="category-image"
                  />
                )}

                <TouchableOpacity
                  onPress={() => {
                    // Handle button press
                    router.replace(`/menu?categoryParam=${promotion.category}`)
                  }}
                  accessibilityLabel={`View more for ${promotion.title}`}
                  accessibilityHint={`Press to view more about ${promotion.title}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: false }}
                  accessibilityLabelledBy="view-more-button"
                  className="bg-primary rounded-lg p-3 items-center w-1/2 mt-4 mx-auto"
                >
                  <Text style={{ color: "#FFFFFF", fontWeight: "bold" }}>
                    Order Here
                  </Text>
                </TouchableOpacity>
              </View>
            ))}

            <View className="border border-gray-200 my-6"></View>
          </>
        )}

        <>
          <Text className="text-4xl font-bold text-primary p-5 text-center">
            Our Dessert Series
          </Text>
          {homepageCards.map((category, index) => {
            return (
              <View
                key={index}
                className="flex justify-center bg-white mx-10 py-5 my-4 gap-5 rounded-2xl shadow-sm"
              >
                <Text className="text-primary font-bold text-2xl text-center">
                  {category.title}
                </Text>
                <Image
                  source={{ uri: category.image }}
                  className="w-full bg-white h-80 mx-auto object-cover rounded-lg mt-2"
                  resizeMode="contain"
                  alt={category.title}
                  accessibilityLabel={category.title}
                  accessibilityHint={`This is an image of ${category.title}`}
                  accessibilityRole="image"
                  accessibilityState={{ selected: true }}
                  accessibilityLabelledBy="category-image"
                />
                <TouchableOpacity
                  onPress={() => {
                    // Handle button press
                    router.replace(`/menu?categoryParam=${category.category}`)
                  }}
                  accessibilityLabel={`View more for ${category.title}`}
                  accessibilityHint={`Press to view more about ${category.title}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: false }}
                  accessibilityLabelledBy="view-more-button"
                  className="bg-primary rounded-lg p-3 items-center w-1/2 mt-4 mx-auto"
                  // style={{
                  //   backgroundColor: "#007BFF", // Replace with your desired button color
                  //   padding: 10,
                  //   borderRadius: 5,
                  //   alignItems: "center",
                  // }}
                >
                  <Text style={{ color: "#FFFFFF", fontWeight: "bold" }}>
                    View More
                  </Text>
                </TouchableOpacity>
              </View>
            )
          })}
        </>
      </ScrollView>
    </View>
  )
}
