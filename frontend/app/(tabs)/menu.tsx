import {
  View,
  Text,
  FlatList,
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
import { useMenuQuery } from "@/services/queries"
import CustomModal from "@/_components/modal"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { useAuth } from "@/store/authProvider"
import { DessertCard } from "@/_components/dessertCard"

export default function Menu() {
  const [selectedCategory, setSelectedCategory] =
    useState<DessertCategory | null>(null)
  const { categoryParam } = useLocalSearchParams()
  const [selectedDessert, setSelectedDessert] = useState<Dessert | null>(null)
  const [modalVisible, setModalVisible] = useState(false)
  const [previousIndex, setPreviousIndex] = useState(0)
  const { token, usersMembership, authLoading, dataLoading } = useAuth()
  const flatListRef = useRef<FlatList<Dessert>>(null)
  const router = useRouter()
  const cartItems = useCartStore((state) => state.items)

  // Shared cache key with the home and rewards tabs, so the menu is fetched
  // once per session rather than once per tab.
  const { data: menu, isLoading: loading } = useMenuQuery()

  // Hoisted so the list keeps a stable renderItem identity across renders;
  // an inline arrow defeats FlatList's own cell memoisation.
  const renderDessert = useCallback(
    ({ item }: { item: Dessert }) => (
      <DessertCard
        dessert={item}
        token={token}
        usersMembership={usersMembership}
        setSelectedDessert={setSelectedDessert}
        setModalVisible={setModalVisible}
        router={router}
        currency="cents"
        membershipPending={dataLoading}
      />
    ),
    [token, usersMembership, router, dataLoading],
  )

  const keyExtractor = useCallback((item: Dessert) => item.id.toString(), [])

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
    }, [categoryParam, menu]),
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
        {loading || authLoading ? (
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
              /* One flat list of desserts. This used to be a vertical FlatList
                 of desserts nested inside a vertical FlatList whose data was
                 `[selectedCategory]` — the inner list could not resolve a
                 viewport through the outer one's cell, so virtualisation was
                 off and every dessert mounted at once, each with a 288pt
                 remote image. */
              <FlatList
                ref={flatListRef}
                data={selectedCategory.desserts}
                keyExtractor={keyExtractor}
                renderItem={renderDessert}
                ListHeaderComponent={
                  <Text className="text-3xl font-bold text-center mb-6 mt-8">
                    {selectedCategory.name}
                  </Text>
                }
                initialNumToRender={4}
                maxToRenderPerBatch={4}
                windowSize={7}
                removeClippedSubviews
                contentContainerStyle={{ paddingBottom: 32 }}
              />
            ) : (
              <View className="flex-1 items-center justify-center mt-16">
                <Text className="text-xl font-bold text-center">
                  No desserts available for this category.
                </Text>
              </View>
            )}
            {modalVisible && selectedDessert && (
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
