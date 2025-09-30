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
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import BouncingLoader from "@/_components/loader"
import { useCartStore } from "@/store/cart"
import ViewCart from "@/_components/viewCart"
import { fetchCategoriesWithDesserts } from "@/services/api"
import useFetch from "@/services/use_fetch"
import CustomModal from "@/_components/modal"
import Toast from "react-native-toast-message"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { useAuth } from "@/store/authProvider"
import { formatCurrency } from "@/lib/formatters"

export default function Menu() {
  const [selectedCategory, setSelectedCategory] =
    useState<DessertCategory | null>(null)
  const { categoryParam } = useLocalSearchParams()
  const [selectedDessert, setSelectedDessert] = useState<Dessert | null>(null)
  const [modalVisible, setModalVisible] = useState(false)
  const [previousIndex, setPreviousIndex] = useState(0)
  const { token, usersMembership } = useAuth()

  const router = useRouter()
  const cartItems = useCartStore((state) => state.items)

  const { data: menu, loading } = useFetch(() => fetchCategoriesWithDesserts())

  useFocusEffect(
    useCallback(() => {
      const fetchData = async () => {
        if (!menu) return

        const selected = categoryParam
          ? menu.find((cat) => cat.name === categoryParam)
          : menu[0]

        if (selected) {
          setSelectedCategory(selected)
          scrollToCategory(selected.id)
        }
      }

      fetchData()
    }, [categoryParam, menu])
  )

  const changeCategory = (newCategory: string) => {
    router.replace({
      pathname: "/menu",
      params: { categoryParam: newCategory },
    })
  }

  // useEffect(() => {
  //   if (menu && menu.length > 0) {
  //     const selectedCategory = menu.find((cat) => cat.id === activeCategory)
  //     scrollToCategory(activeCategory)
  //     setSelectedCategory(selectedCategory || null)
  //   }
  // }, [activeCategory])

  const handleCategoryChange = (category: DessertCategory) => {
    changeCategory(category.name)
  }

  const scrollViewRef = useRef<ScrollView>(null)

  const scrollToCategory = (id: string) => {
    if (!menu) return

    const index = menu.findIndex((cat) => cat.id === id)
    if (scrollViewRef.current) {
      const newIndex =
        index >= previousIndex
          ? index < 6
            ? index * 130
            : index < 7
            ? index * 145
            : index * 160
          : index < 3
          ? index
          : index < 4
          ? index * 50
          : index < 5
          ? index * 70
          : index < 6
          ? index * 100
          : index < 7
          ? index * 120
          : index < 8
          ? index * 135
          : index * 140
      scrollViewRef.current.scrollTo({
        x: newIndex,
        animated: true,
      })
      setPreviousIndex(index)
    }
  }

  return (
    <SafeAreaProvider>
      <View className="flex-1 bg-background">
        <PageHeader />
        {cartItems?.length > 0 && <ViewCart />}
        {loading ? (
          <View
            className={`flex-1 items-center justify-center ${
              Platform.OS === "ios" ? "mt-32" : "mt-24"
            }`}
          >
            <BouncingLoader />
          </View>
        ) : (
          <>
            {menu && menu.length > 0 && (
              <ScrollView
                ref={scrollViewRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{
                  paddingHorizontal: 10,
                  justifyContent: "center",
                  alignItems: "center",
                }}
                className={`${Platform.OS === "ios" ? "mt-32" : "mt-24"} h-24`}
              >
                <View className="flex-row gap-4 items-center rounded-lg">
                  {menu.map((category) => (
                    <TouchableOpacity
                      key={category.id}
                      className={`rounded-full px-4 p-2 text-sm font-medium text-gray-700 ${
                        selectedCategory?.id === category.id
                          ? "bg-secondary text-primary"
                          : ""
                      }`}
                      onPress={() => handleCategoryChange(category)}
                    >
                      <Text className="font-bold text-lg">{category.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            )}
            {selectedCategory ? (
              <FlatList
                data={[selectedCategory]}
                keyExtractor={(item) => item.id.toString()}
                renderItem={({ item }) => (
                  <View className="my-8">
                    {/* Category Name */}
                    <Text className="text-3xl font-bold text-center mb-6">
                      {item.name}
                    </Text>

                    {/* Desserts List */}
                    <FlatList
                      data={item.desserts} // Only this category's desserts
                      keyExtractor={(dessert) => dessert.id.toString()}
                      renderItem={({ item: dessert }) => (
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
                              if (token) {
                                setSelectedDessert(dessert)
                                setModalVisible(true)
                              } else {
                                router.push("/signin")
                              }
                            }}
                            accessibilityLabel={`View more for ${dessert.name}`}
                            accessibilityHint={`Press to view more about ${dessert.name}`}
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
                            <Text
                              style={{ color: "#FFFFFF", fontWeight: "bold" }}
                            >
                              {token ? (
                                <View className="flex-col items-center justify-center">
                                  {/* Regular Price */}
                                  {usersMembership?.isActive ? (
                                    <>
                                      <View className="flex-row items-center gap-1">
                                        <Text className="text-red-600 line-through text-sm">
                                          {formatCurrency(
                                            Number(dessert.priceInCents) / 100
                                          )}
                                        </Text>
                                        {/* Discounted Member Price */}
                                        <Text className="text-white font-bold text-lg">
                                          {formatCurrency(
                                            (Number(dessert.priceInCents) *
                                              0.85) /
                                              100
                                          )}{" "}
                                        </Text>
                                      </View>

                                      <Text className="text-xs text-yellow-300">
                                        Member Price
                                      </Text>
                                    </>
                                  ) : (
                                    <Text className="text-white font-bold text-lg">
                                      {formatCurrency(
                                        Number(dessert.priceInCents) / 100
                                      )}{" "}
                                    </Text>
                                  )}
                                </View>
                              ) : (
                                <Text
                                  style={{
                                    color: "#FFFFFF",
                                    fontWeight: "bold",
                                  }}
                                >
                                  Sign In
                                </Text>
                              )}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    />
                  </View>
                )}
              />
            ) : (
              <View className="flex-1 items-center justify-center mt-16">
                <Text className="text-xl font-bold text-center">
                  No desserts available for this category.
                </Text>
              </View>
            )}
            {modalVisible && (
              <CustomModal
                modalVisible={modalVisible}
                setModalVisible={setModalVisible}
                selectedDessert={selectedDessert}
                type="cents"
              />
            )}
          </>
        )}
      </View>
    </SafeAreaProvider>
  )
}
