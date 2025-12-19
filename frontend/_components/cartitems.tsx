import { formatCurrency } from "@/lib/formatters"
import { useCartStore } from "@/store/cart"
import { CartItem } from "@/utils/types"
import { debounce } from "lodash"
import { useEffect, useMemo, useState } from "react"
import { View, Text, TouchableOpacity } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { updateCartItemQuantity } from "@/services/api"

type CartItemProps = {
  item: CartItem
  setSelectedCartItem: React.Dispatch<React.SetStateAction<CartItem>>
  setType: React.Dispatch<React.SetStateAction<"points" | "cents">>
  setModalVisible: React.Dispatch<React.SetStateAction<boolean>>
  setDebounceActive: React.Dispatch<React.SetStateAction<boolean>>
}

export function CartItems({
  item,
  setSelectedCartItem,
  setType,
  setModalVisible,
  setDebounceActive,
}: CartItemProps) {
  const removeItem = useCartStore((state) => state.removeItem)
  const incrementItem = useCartStore((state) => state.incrementItem)
  const decrementItem = useCartStore((state) => state.decrementItem)
  const updateCartItemQuantity = useCartStore(
    (state) => state.updateCartItemQuantity
  )
  const syncQuantity = useMemo(
    () =>
      debounce((quantity: number) => {
        updateCartItemQuantity(item.id, quantity).then(() => {
          setDebounceActive(false)
        })
      }, 500),
    [item.id]
  )

  // Cleanup on unmount (very important in lists)
  useEffect(() => {
    return () => {
      syncQuantity.cancel()
    }
  }, [syncQuantity])

  const handleIncrement = () => {
    setDebounceActive(true)
    const nextQty = item.quantity + 1
    incrementItem(item.id)
    syncQuantity(nextQty)
  }

  const handleDecrement = () => {
    setDebounceActive(true)
    const nextQty = item.quantity - 1
    decrementItem(item.id)
    syncQuantity(nextQty)
  }

  const isDecrementDisabled =
    !!item.loyaltyPointsUsed ||
    item.quantity <= 1 ||
    !!item.offerId ||
    item.isPromotionItem

  const isIncrementDisabled =
    !!item.loyaltyPointsUsed || !!item.offerId || item.isPromotionItem

  return (
    <View className="py-3 border-b border-gray-200">
      <View className="flex-row justify-between py-3">
        <View className="flex-1 pr-2">
          <Text className="text-lg font-semibold ">
            {item.dessert.name}{" "}
            {item.offerId
              ? "(Members Offer)"
              : item.isPromotionItem
              ? "(Promotion)"
              : ""}
          </Text>
          {item.customisations.map((customisation) => {
            return (
              <Text key={customisation.id}>{`${
                customisation.quantity === 0 ? `- ` : `+ `
              } ${customisation.name} ${
                customisation.quantity > 1 ? `x${customisation.quantity}` : ``
              }`}</Text>
            )
          })}
        </View>
        <Text className="text-lg font-semibold">
          {formatCurrency(
            Number(item.itemPriceInCents - item.discountedAmountInCents) / 100
          )}
        </Text>
      </View>
      <View className="flex-row justify-between items-center">
        <View className="flex-row items-center ml-2 gap-10">
          <TouchableOpacity onPress={async () => await removeItem(item.id)}>
            <Ionicons name="trash" size={24} color="red" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              setSelectedCartItem(item)
              setType(item.loyaltyPointsUsed ? "points" : "cents")
              setModalVisible(true)
            }}
          >
            <Text className="text-primary font-bold text-xl">Edit</Text>
          </TouchableOpacity>
        </View>
        <View className="flex-row items-center gap-4">
          <TouchableOpacity
            onPress={handleDecrement}
            className={`w-10 h-10 rounded-full justify-center items-center ${
              isDecrementDisabled ? "bg-gray-300" : "bg-secondary"
            }`}
            disabled={isDecrementDisabled}
          >
            <Text className="text-xl font-bold">-</Text>
          </TouchableOpacity>

          <Text className="text-lg font-semibold">{item.quantity}</Text>

          <TouchableOpacity
            onPress={handleIncrement}
            className={`w-10 h-10 rounded-full justify-center items-center ${
              isIncrementDisabled ? "bg-gray-300" : "bg-secondary"
            }`}
            disabled={isIncrementDisabled}
          >
            <Text className="text-xl font-bold">+</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )
}
