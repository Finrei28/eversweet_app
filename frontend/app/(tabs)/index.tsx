import React, { useEffect, useState } from "react"
import {
  Text,
  View,
  Image,
  TouchableOpacity,
  ScrollView,
  Platform,
  Dimensions,
} from "react-native"
import PageHeader from "@/_components/pageheader"
import Carousel from "react-native-reanimated-carousel"
import { useSharedValue } from "react-native-reanimated"
import { SplashScreen, useRouter } from "expo-router"
import { FontAwesome } from "@expo/vector-icons"
import { getHomepageCards, showOfferForClient } from "@/services/api"
import BouncingLoader from "@/_components/loader"
import { HomePageContent, offerForClient } from "@/utils/types"
import {
  GestureHandlerRootView,
  PanGesture,
} from "react-native-gesture-handler"
import DancingStar from "@/_components/dancingStar"
import { useAuth } from "@/store/authProvider"

// This is needed for the order history screen to properly import FontAwesome
export { FontAwesome }

export default function Index() {
  const router = useRouter()
  const [offers, setOffers] = useState<offerForClient[]>([])
  const [homePageContents, setHomePageContents] = useState<HomePageContent[]>(
    [],
  )
  const { token, usersMembership, authLoading, dataLoading } = useAuth()
  const progressValue = useSharedValue(0)
  const [activeIndex, setActiveIndex] = useState(0)
  const screen = Dimensions.get("window")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    async function loadContents() {
      try {
        setLoading(true)
        const homePageData = await getHomepageCards()
        const offerData = await showOfferForClient()
        setOffers(offerData)
        setHomePageContents(homePageData)
      } catch (error) {
        console.error("Error loading home content", error)
      } finally {
        setLoading(false)
      }
    }
    loadContents()
  }, [])

  if (loading || authLoading || dataLoading) {
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
      <ScrollView
        className={`${Platform.OS === "ios" ? "mt-32" : "mt-24"}`}
        nestedScrollEnabled={true}
      >
        <GestureHandlerRootView style={{ flex: 1 }}>
          {offers?.length > 0 && (
            <>
              <View className="flex-row items-center justify-center p-5 mt-4 text-center gap-5">
                <DancingStar />
                <Text className=" text-4xl font-bold text-primary ">
                  Special Offers
                </Text>
                <DancingStar />
              </View>

              <Carousel
                loop={false}
                width={screen.width} // width of each card
                height={450} // height of carousel
                autoPlay={false}
                data={offers}
                scrollAnimationDuration={400}
                onProgressChange={(_, absoluteProgress) => {
                  progressValue.value = absoluteProgress
                  setActiveIndex(Math.round(absoluteProgress))
                }}
                onConfigurePanGesture={(panGesture: PanGesture) => {
                  panGesture.activeOffsetX([-10, 10]).failOffsetY([-5, 5])
                }}
                style={{ alignSelf: "center" }}
                renderItem={({ item }) => {
                  return (
                    <View
                      key={item.id}
                      className="bg-white rounded-2xl shadow-sm p-5 mx-10 mb-1"
                      style={{
                        backgroundColor: "#fff",
                        alignSelf: "center", // center the card in the carousel
                      }}
                    >
                      <View className="flex-1 justify-between">
                        <Text className="text-primary font-bold text-2xl text-center mt-2">
                          {item.name}
                        </Text>
                        <Text className="text-gray-500 font-semibold text-md text-center px-6 mt-2">
                          {item.description}
                        </Text>
                        {/* {item.text2 && (
                        <Text className="text-gray-500 font-semibold text-md text-center px-6 mt-1">
                          {item.text2}
                        </Text>
                      )} */}

                        <Image
                          source={{
                            uri:
                              item.image ??
                              item.dessert?.imagePath ??
                              item.category?.desserts?.[0]?.imagePath,
                          }}
                          className="h-60 rounded-lg mt-4"
                          resizeMode="contain"
                          alt={item.name}
                        />

                        <TouchableOpacity
                          onPress={() =>
                            router.push(`${token ? "/membership" : "/signin"}`)
                          }
                          className="bg-primary rounded-lg p-3 items-center mt-4 mx-20"
                        >
                          <Text className="text-white font-bold">
                            {usersMembership?.isActive
                              ? "Show More"
                              : token
                                ? "Get Membership"
                                : "Sign In to View"}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )
                }}
              />

              {/* Dots indicator */}
              {offers.length > 1 && (
                <View className="flex-row justify-center mt-2">
                  {offers.map((_, i) => (
                    <View
                      key={i}
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 5,
                        marginHorizontal: 4,
                        backgroundColor:
                          activeIndex === i ? "#F59E0B" : "#D1D5DB",
                      }}
                    />
                  ))}
                </View>
              )}

              <View className="border border-gray-200 mt-8 mb-4" />
            </>
          )}

          <Text
            className={`text-4xl font-bold text-primary p-5 text-center ${
              offers?.length === 0 ? "mt-4" : ""
            }`}
          >
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
        </GestureHandlerRootView>
      </ScrollView>
    </View>
  )
}
