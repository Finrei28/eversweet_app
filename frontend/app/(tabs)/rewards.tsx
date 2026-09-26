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
import { useRouter } from "expo-router"
import BouncingLoader from "@/_components/loader"
import { useCartStore } from "@/store/cart"
import ViewCart from "@/_components/viewCart"
import { useMenuQuery } from "@/services/queries"
import CustomModal from "@/_components/modal"
import { useLoyaltyStore } from "@/store/points"
import { pointsExpiryNotice } from "@/lib/pointsExpiry"
import { useAuth } from "@/store/authProvider"
import { DessertCard } from "@/_components/dessertCard"
import { SweetPointIcon } from "@/_components/sweetPointIcon"
import { useCategoryBarScroll } from "@/lib/useCategoryBarScroll"

export default function Loyalty() {
  const { token, authLoading, usersMembership } = useAuth()
  const [selectedCategory, setSelectedCategory] =
    useState<DessertCategory | null>(null)
  const [activeCategory, setActiveCategory] = useState<string>("")
  const [selectedDessert, setSelectedDessert] = useState<Dessert | null>(null)
  const [modalVisible, setModalVisible] = useState(false)
  const flatListRef = useRef<FlatList<Dessert>>(null)
  const { scrollViewRef, scrollToCategory: scrollBarTo, onPillLayout } =
    useCategoryBarScroll()
  const router = useRouter()

  const cartItems = useCartStore((state) => state.items)

  const loyaltyPoints = useLoyaltyStore((state) => state.points)
  const pointsExpireAt = useLoyaltyStore((state) => state.expiresAt)
  const expiryNotice = pointsExpiryNotice(pointsExpireAt, loyaltyPoints)

  const { data: categories, isLoading: categoriesLoading } = useMenuQuery()

  // Hoisted to keep a stable identity across renders — see the note on the
  // list below.
  // Selects the category and brings its pill into view. Stable: both halves are.
  const scrollToCategory = useCallback(
    (id: string) => {
      setActiveCategory(id)
      scrollBarTo(id)
    },
    [scrollBarTo],
  )

  const renderDessert = useCallback(
    ({ item }: { item: Dessert }) => (
      <DessertCard
        dessert={item}
        token={token}
        usersMembership={usersMembership}
        setSelectedDessert={setSelectedDessert}
        setModalVisible={setModalVisible}
        router={router}
        currency="points"
        loyaltyPoints={loyaltyPoints}
      />
    ),
    [token, usersMembership, router, loyaltyPoints],
  )

  const keyExtractor = useCallback((item: Dessert) => item.id.toString(), [])


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
        // Here rather than left to the activeCategory effect below: a refreshed menu whose
        // first category keeps its id sets activeCategory to the value it already holds,
        // React skips that update, and the effect never runs — the refreshed list would
        // stay wherever the customer had scrolled it.
        flatListRef.current?.scrollToOffset({ offset: 0, animated: true })
      }
    }
    fetchData()
    // scrollToCategory is stable, so this still runs only when the menu arrives or actually
    // changes (react-query keeps the same array while the data is unchanged).
  }, [categories, scrollToCategory])

  useEffect(() => {
    if (categories && categories.length > 0) {
      const selectedCategory = categories.find(
        (cat) => cat.id === activeCategory,
      )
      setSelectedCategory(selectedCategory || null)
      if (flatListRef.current) {
        flatListRef.current.scrollToOffset({ offset: 0, animated: true })
      }
    }
    // Reacts to the customer picking a category; the menu is only read here. A changed menu
    // is the effect above's: it reselects and resets the list itself. Listing categories here
    // too would run this in the same pass with the previous activeCategory — on first load
    // that selects nothing over the first category, and the tab renders empty for a frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory])


  return (
    <>
      <View className="flex-1 bg-background">
        <PageHeader />
        {cartItems?.length > 0 && <ViewCart />}
        {categoriesLoading || authLoading ? (
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
                    className={`${
                      Platform.OS === "ios" ? "mt-32" : "mt-24"
                    } h-24`}
                  >
                    <View className="flex-row gap-4 items-center rounded-lg">
                      {categories.map((category) => (
                        <TouchableOpacity
                          key={category.id}
                          onLayout={onPillLayout(category.id)}
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
                  <SweetPointIcon size={28} />
                  <Text className="font-bold text-4xl text-primary">
                    {loyaltyPoints ?? 0}
                  </Text>
                  <Text className="font-bold text-2xl text-gray-500">
                    points
                  </Text>
                </View>
                {expiryNotice && (
                  <Text className="text-center text-gray-500 -mt-4 mb-6 px-6">
                    {expiryNotice}
                  </Text>
                )}
                {selectedCategory ? (
                  /* Flattened for the same reason as the menu screen: a
                     vertical FlatList nested in a vertical FlatList cannot
                     virtualise, so every dessert mounted eagerly. */
                  <FlatList
                    ref={flatListRef}
                    data={selectedCategory.desserts}
                    keyExtractor={keyExtractor}
                    renderItem={renderDessert}
                    ListHeaderComponent={
                      <Text className="text-3xl font-bold text-center mb-6">
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
                  <View className="flex-1 items-center justify-center">
                    <Text className="text-xl font-bold text-center mb-6">
                      No desserts available for this category.
                    </Text>
                  </View>
                )}
                {modalVisible && selectedDessert && (
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
