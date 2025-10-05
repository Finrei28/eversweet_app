import React, { useEffect } from "react"
import {
  Text,
  View,
  Image,
  TouchableOpacity,
  ScrollView,
  Platform,
} from "react-native"
import PageHeader from "@/_components/pageheader"
import { SplashScreen, useRouter } from "expo-router"
import { FontAwesome } from "@expo/vector-icons"
import useFetch from "@/services/use_fetch"
import { getHomepageCards, getPromotions } from "@/services/api"
import BouncingLoader from "@/_components/loader"

// Keep splash screen on when loading data
SplashScreen.preventAutoHideAsync()

// This is needed for the order history screen to properly import FontAwesome
export { FontAwesome }

export default function Index() {
  const router = useRouter()
  const { data: promotions, loading: loadingPromotions } = useFetch(() =>
    getPromotions()
  )
  const { data: homePageContents, loading: loadingContents } = useFetch(() =>
    getHomepageCards()
  )
  useEffect(() => {
    if (!loadingPromotions && !loadingContents) {
      SplashScreen.hideAsync()
    }
  }, [loadingPromotions])
  if (!homePageContents || homePageContents?.length === 0) {
    return (
      <View className="flex-1 bg-background">
        <PageHeader />
        <View
          className={`flex-1 items-center justify-center ${
            Platform.OS === "ios" ? "mt-32" : "mt-24"
          }`}
        >
          <BouncingLoader />
        </View>
      </View>
    )
  }
  return (
    <View className="flex-1 bg-background">
      <PageHeader />
      <ScrollView className={`${Platform.OS === "ios" ? "mt-32" : "mt-24"}`}>
        {promotions?.length > 0 && (
          <>
            <Text className=" text-4xl font-bold text-primary p-5 mt-4 text-center">
              Promotions
            </Text>

            {promotions?.map((promotion) => (
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
          <Text className="text-4xl font-bold text-primary p-5 mt-4 text-center">
            Our Dessert Series
          </Text>
          {homePageContents?.map((category, index) => {
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
