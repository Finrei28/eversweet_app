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
import { DessertCard } from "@/_components/dessertCard"

export default function Menu() {
  const [selectedCategory, setSelectedCategory] =
    useState<DessertCategory | null>(null)
  const { categoryParam } = useLocalSearchParams()
  const [selectedDessert, setSelectedDessert] = useState<Dessert | null>(null)
  const [modalVisible, setModalVisible] = useState(false)
  const [previousIndex, setPreviousIndex] = useState(0)
  const { token, usersMembership } = useAuth()
  const flatListRef = useRef<FlatList<DessertCategory>>(null)
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

  useEffect(() => {
    if (flatListRef.current) {
      flatListRef.current.scrollToOffset({ offset: 0, animated: true })
    }
  }, [categoryParam])

  const changeCategory = (newCategory: string) => {
    router.replace({
      pathname: "/menu",
      params: { categoryParam: newCategory },
    })
  }

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
                ref={flatListRef}
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
                        <DessertCard
                          dessert={dessert}
                          token={token}
                          usersMembership={usersMembership}
                          setSelectedDessert={setSelectedDessert}
                          setModalVisible={setModalVisible}
                          router={router}
                          currency="cents"
                        />
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
