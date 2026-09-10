import { View, Text, FlatList, TouchableOpacity } from "react-native"
import { useCartStore } from "@/store/cart"
import {
  useFocusEffect,
  useNavigation,
  useRoute,
} from "@react-navigation/native"
import { useCallback, useEffect, useState } from "react"
import { CartItem } from "@/utils/types"
import CustomModal from "@/_components/modal"
import CustomHeader from "@/_components/custom-header"
import { router } from "expo-router"
import { useAuth } from "@/store/authProvider"
import { formatCurrency } from "@/lib/formatters"
import { CartItems } from "@/_components/cartitems"
import { SweetPointIcon } from "@/_components/sweetPointIcon"

export default function CartPage() {
  const navigation = useNavigation()
  const route = useRoute()
  const { usersMembership } = useAuth()
  const cartItems = useCartStore((state) => state.items)
  const clearCart = useCartStore((state) => state.clearCart)

  const getTotalCost = useCartStore((state) => state.getTotalCost)
  const getEarnablePoints = useCartStore((state) => state.getEarnablePoints)
  const [selectedCartItem, setSelectedCartItem] = useState<CartItem | null>(
    null,
  )
  const [offerId, setOfferId] = useState<string | null>(null)
  const [modalVisible, setModalVisible] = useState(false)
  const [type, setType] = useState<"points" | "cents">("cents")
  const [earnablePoints, setEarnablePoints] = useState<number | null>(null)
  const total = getTotalCost()

  useFocusEffect(
    useCallback(() => {
      const title = "Back"

      navigation.setOptions({
        headerBackTitle: title,
      })
    }, [navigation, route.key]),
  )
  const totalCost = getTotalCost()
  useEffect(() => {
    // This refires whenever the cart total changes, so a slow response from an
    // earlier edit must not overwrite the result of a later one.
    let cancelled = false
    const fetchPoints = async () => {
      try {
        const points = await getEarnablePoints(usersMembership)
        if (!cancelled) setEarnablePoints(points)
      } catch (error) {
        console.error("Failed to work out earnable points", error)
      }
    }
    fetchPoints()
    return () => {
      cancelled = true
    }
  }, [usersMembership, totalCost])

  // if (cartOperations === 1) {
  //   return (
  //     <View className="flex-1 bg-background">
  //       <CustomHeader />
  //       <View className="flex-1 justify-center items-center mb-24">
  //         <BouncingLoader />
  //       </View>
  //     </View>
  //   )
  // }

  return (
    <>
      <CustomHeader />
      <View className="flex-1 bg-background pt-5 px-5 pb-10">
        <Text className="text-2xl font-bold mb-5 text-center">Your Cart</Text>

        {cartItems?.length === 0 ? (
          <View className="flex-1 justify-center items-center mb-24">
            <Text className="text-base text-center text-gray-500">
              Your cart is empty.
            </Text>
          </View>
        ) : (
          <>
            <FlatList
              data={cartItems}
              keyExtractor={(item, index) => `${item.id}-${index}`}
              renderItem={({ item }) => (
                <CartItems
                  item={item}
                  setSelectedCartItem={setSelectedCartItem}
                  setType={setType}
                  setModalVisible={setModalVisible}
                  setOfferId={setOfferId}
                />
              )}
            />

            <View className="mt-5 border-t border-gray-300 pt-4">
              <View className="items-center flex-row justify-between">
                <TouchableOpacity onPress={async () => await clearCart()}>
                  <Text className="text-red-500 text-xl">Clear cart</Text>
                </TouchableOpacity>
                <View>
                  <Text className="text-lg font-bold text-right">
                    Total: {formatCurrency(total / 100)}
                  </Text>
                  {total > 0 && (
                    <View className="flex-row items-center justify-end gap-1">
                      <Text className="text-gray-500">Earn</Text>
                      <SweetPointIcon size={14} accessibilityLabel="points" />
                      <Text className="font-semibold text-primary">
                        {earnablePoints}
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              <TouchableOpacity
                onPress={() => router.push("/checkout")}
                className="mt-4 bg-primary py-3 rounded-lg items-center"
              >
                <Text className="text-white font-bold">Checkout</Text>
              </TouchableOpacity>
            </View>
            {modalVisible && selectedCartItem && (
              <CustomModal
                modalVisible={modalVisible}
                setModalVisible={setModalVisible}
                selectedDessert={selectedCartItem.dessert}
                type={type}
                state="edit"
                cartItem={selectedCartItem}
                offerId={offerId}
              />
            )}
          </>
        )}
      </View>
    </>
  )
}
