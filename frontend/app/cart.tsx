import { View, Text, FlatList, TouchableOpacity } from "react-native"
import { useCartStore } from "@/store/cart"
import AntDesign from "@expo/vector-icons/AntDesign"
import {
  useFocusEffect,
  useNavigation,
  useRoute,
} from "@react-navigation/native"
import { useCallback, useState } from "react"
import { Customisations, Dessert } from "@/utils/types"
import CustomModal from "@/_components/modal"
import Toast from "react-native-toast-message"
import CustomHeader from "@/_components/custom-header"
import { router } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { useAuth } from "@/store/authProvider"

export default function CartPage() {
  const navigation = useNavigation()
  const route = useRoute()
  const { usersMembership } = useAuth()
  const cartItems = useCartStore((state) => state.items)
  const clearCart = useCartStore((state) => state.clearCart)
  const removeItem = useCartStore((state) => state.removeItem)
  const incrementItem = useCartStore((state) => state.incrementItem)
  const decrementItem = useCartStore((state) => state.decrementItem)
  const getTotalCost = useCartStore((state) => state.getTotalCost)
  const getEarnablePoints = useCartStore((state) => state.getEarnablePoints)
  const [selectedDessert, setSelectedDessert] = useState<Dessert | null>(null)
  const [selectedDessertCustomisations, setSelectedDessertCustomisations] =
    useState<Customisations | null>(null)
  const [selectedDessertPriceInCents, setSelectedDessertPriceInCents] =
    useState<number | null>(null)
  const [modalVisible, setModalVisible] = useState(false)
  const [type, setType] = useState<"points" | "cents">("cents")
  const [editId, setEditId] = useState<string | null>(null)

  const total = getTotalCost()

  useFocusEffect(
    useCallback(() => {
      const title = "Back"

      navigation.setOptions({
        headerBackTitle: title,
      })
    }, [navigation, route.key])
  )

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
                <View className="py-3 border-b border-gray-200">
                  <View className="flex-row justify-between py-3">
                    <View className="flex-1 pr-2">
                      <Text className="text-lg font-semibold ">
                        {item.dessert.name}{" "}
                        {item.offerId ? "(Members Offer)" : ""}
                      </Text>
                      {item.customisations.map((customisation) => {
                        return (
                          <Text key={customisation.id}>{`${
                            customisation.quantity === 0 ? `- ` : `+ `
                          } ${customisation.name} ${
                            customisation.quantity > 1
                              ? `x${customisation.quantity}`
                              : ``
                          }`}</Text>
                        )
                      })}
                    </View>
                    <Text className="text-lg font-semibold">
                      ${(Number(item.itemPriceInCents) / 100).toFixed(2)}
                    </Text>
                  </View>
                  <View className="flex-row justify-between items-center">
                    <View className="flex-row items-center ml-2 gap-10">
                      <TouchableOpacity
                        onPress={async () => await removeItem(item.id)}
                      >
                        <Ionicons name="trash" size={24} color="red" />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => {
                          setSelectedDessert(item.dessert)
                          setSelectedDessertCustomisations(item.customisations)
                          setSelectedDessertPriceInCents(item.itemPriceInCents)
                          setType(item.loyaltyPointsUsed ? "points" : "cents")
                          setEditId(item.id)
                          setModalVisible(true)
                        }}
                      >
                        <Text className="text-primary font-bold text-xl">
                          Edit
                        </Text>
                      </TouchableOpacity>
                    </View>
                    <View className="flex-row items-center gap-4">
                      <TouchableOpacity
                        onPress={async () => await decrementItem(item.id)}
                        className={`w-10 h-10 rounded-full justify-center items-center ${
                          item.loyaltyPointsUsed
                            ? "bg-gray-300"
                            : "bg-secondary"
                        }`}
                        disabled={
                          !!item.loyaltyPointsUsed ||
                          item.quantity <= 1 ||
                          !!item.offerId
                        }
                      >
                        <Text className="text-xl font-bold">-</Text>
                      </TouchableOpacity>

                      <Text className="text-lg font-semibold">
                        {item.quantity}
                      </Text>

                      <TouchableOpacity
                        onPress={async () => await incrementItem(item.id)}
                        className={`w-10 h-10 rounded-full justify-center items-center ${
                          item.loyaltyPointsUsed
                            ? "bg-gray-300"
                            : "bg-secondary"
                        }`}
                        disabled={!!item.loyaltyPointsUsed || !!item.offerId}
                      >
                        <Text className="text-xl font-bold">+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              )}
            />

            <View className="mt-5 border-t border-gray-300 pt-4">
              <View className="items-center flex-row justify-between">
                <TouchableOpacity onPress={async () => await clearCart()}>
                  <Text className="text-red-500 text-xl">Clear cart</Text>
                </TouchableOpacity>
                <View>
                  <Text className="text-lg font-bold text-right">
                    Total: ${(total / 100).toFixed(2)}
                  </Text>
                  {total > 0 && (
                    <Text>
                      Earnable points: {getEarnablePoints(usersMembership)}
                    </Text>
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
            {modalVisible && (
              <CustomModal
                modalVisible={modalVisible}
                setModalVisible={setModalVisible}
                selectedDessert={selectedDessert}
                type={type}
                state="edit"
                customisations={selectedDessertCustomisations}
                editItemPrice={selectedDessertPriceInCents}
                editId={editId}
              />
            )}
          </>
        )}
      </View>
    </>
  )
}
