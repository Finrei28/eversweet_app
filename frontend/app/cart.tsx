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
import BouncingLoader from "@/_components/loader"
import { CartItems } from "@/_components/cartitems"

export default function CartPage() {
  const navigation = useNavigation()
  const route = useRoute()
  const { usersMembership } = useAuth()
  const cartItems = useCartStore((state) => state.items)
  const cartOperations = useCartStore((state) => state.cartOperations)
  const clearCart = useCartStore((state) => state.clearCart)

  const getTotalCost = useCartStore((state) => state.getTotalCost)
  const getEarnablePoints = useCartStore((state) => state.getEarnablePoints)
  const [selectedCartItem, setSelectedCartItem] = useState<CartItem | null>(
    null
  )
  const [debounceActive, setDebounceActive] = useState(false)
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
    }, [navigation, route.key])
  )
  const totalCost = getTotalCost()
  useEffect(() => {
    const fetchPoints = async () => {
      const points = await getEarnablePoints(usersMembership)
      setEarnablePoints(points)
    }
    fetchPoints()
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
      <CustomHeader disableBack={debounceActive} />
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
                  setDebounceActive={setDebounceActive}
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
                  {total > 0 && <Text>Earnable points: {earnablePoints}</Text>}
                </View>
              </View>

              <TouchableOpacity
                onPress={() => router.push("/checkout")}
                className="mt-4 bg-primary py-3 rounded-lg items-center"
                disabled={debounceActive}
              >
                <Text className="text-white font-bold">Checkout</Text>
              </TouchableOpacity>
            </View>
            {modalVisible && (
              <CustomModal
                modalVisible={modalVisible}
                setModalVisible={setModalVisible}
                selectedDessert={selectedCartItem.dessert}
                type={type}
                state="edit"
                cartItem={selectedCartItem}
              />
            )}
          </>
        )}
      </View>
    </>
  )
}
