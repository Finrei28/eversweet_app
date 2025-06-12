import {
  View,
  Text,
  FlatList,
  Image,
  TouchableOpacity,
  ScrollView,
  Platform,
} from "react-native"
import React, { useCallback, useEffect, useRef, useState } from "react"
import PageHeader from "@/_components/pageheader"
import { Dessert, DessertCategory } from "@/utils/types"
import { useFocusEffect, useRouter } from "expo-router"
import BouncingLoader from "@/_components/loader"
import { useCartStore } from "@/store/cart"
import ViewCart from "@/_components/viewCart"
import { fetchCategoriesWithDesserts } from "@/services/api"
import useFetch from "@/services/use_fetch"
import CustomModal from "@/utils/modal"
import { useLoyaltyStore } from "@/store/points"
import { useAuth } from "@/store/authProvider"

export default function Loyalty() {
  const [selectedCategory, setSelectedCategory] =
    useState<DessertCategory | null>(null)
  const [activeCategory, setActiveCategory] = useState<string>("")
  const [selectedDessert, setSelectedDessert] = useState<Dessert | null>(null)
  const [modalVisible, setModalVisible] = useState(false)

  const router = useRouter()

  const cartItems = useCartStore((state) => state.items)

  const { data: categories, loading: categoriesLoading } = useFetch(
    fetchCategoriesWithDesserts
  )

  const { token, loading: loadingToken } = useAuth()

  const loyaltyPoints = useLoyaltyStore((state) => state.points)

  useEffect(() => {
    if (token) {
      useLoyaltyStore.getState().fetchPoints()
    }
  }, [token])

  useEffect(() => {
    const fetchData = async () => {
      if (categories) {
        // Filter desserts on client side because Supabase doesn't support "where" inside select

        setSelectedCategory(categories[0] || null)
        scrollToCategory(categories[0]?.id || "")
      }
    }
    fetchData()
  }, [categories])

  useEffect(() => {
    if (categories && categories.length > 0) {
      const selectedCategory = categories.find(
        (cat) => cat.id === activeCategory
      )
      setSelectedCategory(selectedCategory || null)
      // router.replace("/loyalty")
    }
  }, [activeCategory])

  const scrollViewRef = useRef<ScrollView>(null)

  const scrollToCategory = (id: string) => {
    setActiveCategory(id)

    if (!categories) return

    const index = categories.findIndex((cat) => cat.id === id)
    if (scrollViewRef.current) {
      scrollViewRef.current.scrollTo({ x: index * 120, animated: true })
    }
  }

  return (
    <>
      <View className="flex-1 bg-background">
        <PageHeader />
        {cartItems.length > 0 && <ViewCart />}
        {categoriesLoading || loadingToken ? (
          <View
            className={`flex-1 items-center justify-center ${
              Platform.OS === "ios" ? "mt-32" : "mt-24"
            }`}
          >
            <BouncingLoader />
          </View>
        ) : (
          <>
            {!token ? (
              <View
                className={`flex-1 justify-center items-center ${
                  Platform.OS === "ios" ? "mt-32" : "mt-24"
                }`}
              >
                <Text className="text-xl font-bold text-center px-4">
                  Sign in to view your rewards and earn points
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    router.push({
                      pathname: "/signin",
                      params: { redirectTo: "/rewards" },
                    })
                  }}
                  className="bg-primary p-3 rounded-lg w-1/3 items-center mt-5"
                >
                  <Text className="text-white text-xl">Sign in</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                {categories && categories.length > 0 && (
                  <ScrollView
                    ref={scrollViewRef}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ paddingHorizontal: 10 }}
                    className="mt-36 h-16"
                  >
                    <View className="flex-row gap-4 items-center rounded-lg">
                      {categories.map((category) => (
                        <TouchableOpacity
                          key={category.id}
                          className={`rounded-full px-4 p-2 text-sm font-medium text-gray-700 ${
                            activeCategory === category.id ? "bg-secondary" : ""
                          }`}
                          onPress={() => scrollToCategory(category.id)}
                        >
                          <Text className="font-bold text-lg">
                            {category.name}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                )}
                <View className="flex flex-row justify-center items-center gap-3 my-6">
                  <Text className="font-bold text-4xl ">Points:</Text>
                  <Text className="font-bold text-4xl text-primary">
                    {loyaltyPoints ?? 0}
                  </Text>
                </View>
                {selectedCategory ? (
                  <FlatList
                    data={[selectedCategory]}
                    keyExtractor={(item) => item.id.toString()}
                    renderItem={({ item }) => (
                      <View className="mb-8">
                        {/* Category Name */}
                        <Text className="text-xl font-bold text-center mb-6">
                          {item.name}
                        </Text>

                        {/* Desserts List */}
                        <FlatList
                          data={item.desserts} // Only this category's desserts
                          keyExtractor={(dessert) => dessert.id.toString()}
                          renderItem={({ item: dessert }) => {
                            const requiredPoints =
                              Math.round(Number(dessert.priceInCents) / 5) * 5
                            return (
                              <View className="flex items-center mb-6 shadow-sm bg-white rounded-2xl mx-10 py-5 ">
                                {/* Dessert Image */}
                                <Image
                                  source={{ uri: dessert.imagePath }}
                                  className="relative w-full h-80 rounded-lg"
                                  resizeMode="cover"
                                />
                                {/* Dessert Name */}
                                <Text className="text-lg font-medium">
                                  {dessert.name}
                                </Text>
                                <TouchableOpacity
                                  onPress={() => {
                                    // Handle button press
                                    // addItem({ ...dessert, quantity: quantity,  })
                                    setSelectedDessert(dessert)
                                    setModalVisible(true)
                                  }}
                                  disabled={
                                    requiredPoints > Number(loyaltyPoints)
                                  }
                                  accessibilityLabel={`View more for ${dessert.name}`}
                                  accessibilityHint={`Press to view more about ${dessert.name}`}
                                  accessibilityRole="button"
                                  accessibilityState={{ selected: false }}
                                  accessibilityLabelledBy="view-more-button"
                                  className={`rounded-lg p-3 items-center w-1/2 mt-4 mx-auto 
                                ${
                                  requiredPoints > Number(loyaltyPoints)
                                    ? "bg-gray-300"
                                    : "bg-primary"
                                }`}
                                  // style={{
                                  //   backgroundColor: "#007BFF", // Replace with your desired button color
                                  //   padding: 10,
                                  //   borderRadius: 5,
                                  //   alignItems: "center",
                                  // }}
                                >
                                  <Text
                                    style={{
                                      color: "#FFFFFF",
                                      fontWeight: "bold",
                                    }}
                                  >
                                    Add{" "}
                                    {Math.round(
                                      Number(dessert.priceInCents) / 5
                                    ) * 5}{" "}
                                    points
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            )
                          }}
                        />
                      </View>
                    )}
                  />
                ) : (
                  <View className="flex-1 items-center justify-center">
                    <Text className="text-xl font-bold text-center mb-6">
                      No desserts available for this category.
                    </Text>
                  </View>
                )}
                {modalVisible && (
                  <CustomModal
                    modalVisible={modalVisible}
                    setModalVisible={setModalVisible}
                    selectedDessert={selectedDessert}
                    type="points"
                  />
                )}
              </>
            )}
          </>
        )}
      </View>
    </>
  )
}
