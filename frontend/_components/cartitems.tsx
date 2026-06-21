import { formatCurrency } from "@/lib/formatters"
import { useCartStore } from "@/store/cart"
import { CartItem } from "@/utils/types"
import { debounce } from "lodash"
import { useEffect, useMemo, useRef, useState } from "react"
import { View, Text, TouchableOpacity } from "react-native"
import { Ionicons } from "@expo/vector-icons"

type CartItemProps = {
  item: CartItem
  setSelectedCartItem: React.Dispatch<React.SetStateAction<CartItem | null>>
  setType: React.Dispatch<React.SetStateAction<"points" | "cents">>
  setModalVisible: React.Dispatch<React.SetStateAction<boolean>>
  setDebounceActive: React.Dispatch<React.SetStateAction<boolean>>
  setOfferId: React.Dispatch<React.SetStateAction<string | null>>
}

export function CartItems({
  item,
  setSelectedCartItem,
  setType,
  setModalVisible,
  setDebounceActive,
  setOfferId,
}: CartItemProps) {
  const removeItem = useCartStore((state) => state.removeItem)
  const incrementItem = useCartStore((state) => state.incrementItem)
  const decrementItem = useCartStore((state) => state.decrementItem)
  const [isDeleting, setIsDeleting] = useState(false)
  const updateCartItemQuantity = useCartStore(
    (state) => state.updateCartItemQuantity,
  )
  const syncQuantity = useMemo(
    () =>
      debounce((quantity: number) => {
        updateCartItemQuantity(item.id, quantity).then(() => {
          setDebounceActive(false)
        })
      }, 500),
    [item.id],
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

  const deleteItem = async () => {
    if (isDeleting) return

    setIsDeleting(true)

    try {
      await removeItem(item.id)
    } finally {
      setIsDeleting(false)
    }
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
      <View className="flex-col py-3">
        <View className="flex-row justify-between">
          <View className="flex-1 pr-2">
            <Text className="text-lg font-semibold ">
              {item.dessert.name}{" "}
              {item.offerId
                ? "(Members Offer)"
                : item.dessert.promo?.isActive
                  ? "(Promotion)"
                  : ""}
            </Text>
          </View>
          <Text className="text-lg font-semibold">
            {formatCurrency(
              Number(item.itemPriceInCents - item.discountedAmountInCents) /
                100,
            )}
          </Text>
        </View>
        {item.customisations.map((customisation) => {
          const customisationPriceAfterDiscount =
            (customisation.priceInCents -
              customisation.discountedAmountInCents) *
            customisation.quantity

          return (
            <View
              key={customisation.id}
              className="flex flex-row items-center justify-between"
            >
              <Text>{`${
                customisation.quantity === 0 ? `- ` : `+ `
              } ${customisation.name} ${
                customisation.quantity > 1 ? `x${customisation.quantity}` : ``
              }`}</Text>
              {customisation.quantity > 0 && (
                <Text className="text-sm text-muted-foreground">
                  {formatCurrency(
                    Number(customisationPriceAfterDiscount / 100),
                  )}
                </Text>
              )}
            </View>
          )
        })}
      </View>

      <View className="flex-row justify-between items-center">
        <View className="flex-row items-center ml-2 gap-10">
          <TouchableOpacity disabled={isDeleting} onPress={deleteItem}>
            <Ionicons name="trash" size={24} color="red" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              setSelectedCartItem(item)
              setType(item.loyaltyPointsUsed ? "points" : "cents")
              setModalVisible(true)
              setOfferId(item.offerId)
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
