import { CachedImage } from "@/_components/cachedImage"
import React from "react"
import {
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  Platform,
  Dimensions,
} from "react-native"
import PageHeader from "@/_components/pageheader"
import Carousel from "react-native-reanimated-carousel"
import { useSharedValue } from "react-native-reanimated"
import { CarouselDot } from "@/_components/carouselDot"
import { useRouter } from "expo-router"
import { FontAwesome, Feather } from "@expo/vector-icons"
import { useClientOffersQuery, useMenuQuery } from "@/services/queries"
import BouncingLoader from "@/_components/loader"
import { Menu, offerForClient } from "@/utils/types"
import {
  GestureHandlerRootView,
  PanGesture,
} from "react-native-gesture-handler"
import DancingStar from "@/_components/dancingStar"
import AudienceBadge from "@/_components/audienceBadge"
import { useAuth } from "@/store/authProvider"

// This is needed for the order history screen to properly import FontAwesome
export { FontAwesome }

export default function Index() {
  const router = useRouter()
  const { token, authLoading } = useAuth()
  const progressValue = useSharedValue(0)
  const screen = Dimensions.get("window")

  // Both run in parallel, and the menu shares its cache with the menu and
  // rewards tabs. Returning to this screen now paints from cache.
  const { data: categoryData, isLoading: categoriesLoading } = useMenuQuery()
  const { data: offerData, isLoading: offersLoading } = useClientOffersQuery()

  const categories: Menu = categoryData ?? []
  const offers: offerForClient[] = offerData ?? []
  const loading = categoriesLoading || offersLoading

  // Not gated on dataLoading: this screen reads only `token`, so waiting on the
  // profile, membership and leaderboard requests held the homepage behind four
  // calls whose results it never uses.
  if (loading || authLoading) {
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
                // Handed the shared value itself, not a callback. The carousel
                // wraps a callback in runOnJS, which crashes the UI thread
                // outright when that callback is a worklet and costs a JS hop
                // per frame when it is not. Assigning the shared value is the
                // library's own supported path and stays entirely on the UI
                // thread, which is what the dots below read.
                onProgressChange={progressValue}
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
                        {item.audience !== "EVERYONE" && (
                          <View className="items-center mb-1">
                            <AudienceBadge audience={item.audience} />
                          </View>
                        )}
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

                        <CachedImage
                          uri={
                            item.image ??
                            item.dessert?.imagePath ??
                            item.category?.desserts?.[0]?.imagePath
                          }
                          // Explicit width: with height alone the layout had to
                          // wait on the network to learn the intrinsic size.
                          className="w-full h-60 rounded-lg mt-4"
                          resizeMode="contain"
                          alt={item.name}
                          recyclingKey={item.id}
                        />

                        <TouchableOpacity
                          onPress={() =>
                            router.push(
                              token
                                ? { pathname: "/offers" }
                                : {
                                    pathname: "/signin",
                                    params: { redirectTo: "/offers" },
                                  },
                            )
                          }
                          className="bg-primary rounded-lg p-3 items-center mt-4 mx-20"
                        >
                          <Text className="text-white font-bold">
                            {token ? "View Offer" : "Sign In to View"}
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
                  {offers.map((offer, i) => (
                    <CarouselDot
                      key={offer.id}
                      index={i}
                      progress={progressValue}
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

          {categories.length === 0 ? (
            <View className="bg-white rounded-xl shadow-sm p-6 items-center mx-10 mb-6">
              <Feather name="coffee" size={48} color="#D1D5DB" />
              <Text className="mt-2 text-gray-500 text-center">
                No dessert series available right now. Check back soon!
              </Text>
            </View>
          ) : (
            categories.map((category) => {
              const uri = category.desserts[0]?.imagePath

              return (
                <View
                  key={category.id}
                  className="flex justify-center bg-white mx-10 py-5 my-4 gap-5 rounded-2xl shadow-sm"
                >
                  <Text className="text-primary font-bold text-2xl text-center">
                    {category.name}
                  </Text>
                  {uri && (
                    <CachedImage
                      uri={uri}
                      className="w-full bg-white h-80 mx-auto rounded-lg mt-2"
                      resizeMode="contain"
                      alt={category.name}
                      accessibilityLabel={category.name}
                      accessibilityHint={`This is an image of ${category.name}`}
                      recyclingKey={category.id}
                    />
                  )}
                  <TouchableOpacity
                    onPress={() => {
                      router.replace(
                        `/menu?categoryParam=${encodeURIComponent(category.name)}`,
                      )
                    }}
                    accessibilityLabel={`View menu for ${category.name}`}
                    accessibilityHint={`Press to view the ${category.name} menu`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: false }}
                    accessibilityLabelledBy="view-more-button"
                    className="bg-primary rounded-lg p-3 items-center w-1/2 mt-4 mx-auto"
                  >
                    <Text style={{ color: "#FFFFFF", fontWeight: "bold" }}>
                      View Menu
                    </Text>
                  </TouchableOpacity>
                </View>
              )
            })
          )}
        </GestureHandlerRootView>
      </ScrollView>
    </View>
  )
}
