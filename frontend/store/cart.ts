import { create } from "zustand"
import {
  AddCartItem,
  CartItem,
  Customisations,
  UsersMembership,
} from "@/utils/types"

import {
  addItemToCart,
  clearCart,
  updateCartItemQuantity,
  getCartItems,
  getLoyaltyRates,
  removeItemFromCart,
  updateCartItem,
} from "@/services/api"
import Toast from "react-native-toast-message"
import { useLoyaltyStore } from "./points"
import { isEqual } from "lodash"
import * as Crypto from "expo-crypto"
import {
  calculatePriceAfterMembershipDiscount,
  calculatePriceAfterPromo,
} from "@/lib/priceHelper"

interface CartState {
  items: CartItem[]
  cartOperations: number
  dessertModalTracker: number[]
  error: string | null
  lastRequestId?: number
  addTodessertModalTracker: (id: number) => void
  removeFromDessertModalTracker: (id: number) => void
  fetchCart: () => Promise<void>
  getTotalMembershipDiscount: (
    usersMembership: UsersMembership | null,
  ) => number
  addItem: (item: AddCartItem) => Promise<void>
  editItem: (item: CartItem) => Promise<void>
  removeItem: (id: string) => Promise<void>
  clearCart: () => Promise<void>
  processOrder: () => Promise<void>
  incrementItem: (id: string) => Promise<void>
  decrementItem: (id: string) => Promise<void>
  updateCartItemQuantity: (id: string, quantity: number) => Promise<void>
  setError: (error: string | null) => void
  getTotalItems: () => number
  getTotalCost: () => number
  getEarnablePoints: (
    usersMembership: UsersMembership | null,
  ) => Promise<number>
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  error: null,
  cartOperations: 0,
  dessertModalTracker: [],
  addTodessertModalTracker: (id: number) => {
    set((state) => ({
      dessertModalTracker: state.dessertModalTracker.includes(id)
        ? state.dessertModalTracker
        : [...state.dessertModalTracker, id],
    }))
  },
  removeFromDessertModalTracker: (id: number) => {
    set((state) => ({
      dessertModalTracker: state.dessertModalTracker.filter(
        (trackerId) => trackerId !== id,
      ),
    }))
  },
  fetchCart: async () => {
    try {
      const cartItems = (await getCartItems()) ?? []
      set({ items: cartItems })
    } catch (error) {
      console.error("Failed to fetch cart items", error)
    }
  },
  getTotalMembershipDiscount: (usersMembership: UsersMembership | null) => {
    return get().items.reduce((total, item) => {
      const dessertPrice = item.dessert.priceInCents
      const membershipPrice = calculatePriceAfterMembershipDiscount(
        dessertPrice,
        usersMembership,
      )
      const promoPrice = calculatePriceAfterPromo(item.dessert)
      const customisationDiscountedAmount = item.customisations.reduce(
        (acc, c) =>
          acc + (c.quantity > 0 ? c.discountedAmountInCents * c.quantity : 0),
        0,
      )

      return (
        total +
        (!item.offerId &&
        !item.loyaltyPointsUsed &&
        membershipPrice <= promoPrice
          ? item.discountedAmountInCents * item.quantity // find desserts that are not offers, loyaltlies and only if membership discount is > promo discount (lowest price)
          : 0) +
        customisationDiscountedAmount * item.quantity // find customisation discount separately because customisation is always member discounted
      )
    }, 0)
  },
  addItem: async (item, usersMembership?: UsersMembership) => {
    const areListsEqual = (list1: Customisations, list2: Customisations) => {
      if (list1.length !== list2.length) return false

      const sortedList1 = [...list1].sort((a, b) => a.id.localeCompare(b.id))
      const sortedList2 = [...list2].sort((a, b) => a.id.localeCompare(b.id))

      return sortedList1.every((item, index) =>
        isEqual(item, sortedList2[index]),
      )
    }

    const existing = get().items.find((i) => {
      return (
        i.dessert.id === item.dessert.id &&
        i.loyaltyPointsUsed === item.loyaltyPointsUsed &&
        i.offerId === item.offerId &&
        Math.round(i.itemPriceInCents) === Math.round(item.itemPriceInCents) &&
        areListsEqual(i.customisations, item.customisations) &&
        !i.isPromotionItem
      )
    })

    // if (existing) {
    //   set({
    //     items: get().items.map((i) =>
    //       i.id === existing.id ? { ...i, quantity: i.quantity + 1 } : i
    //     ),
    //     cartOperations: get().cartOperations + 1,
    //   })
    // } else {
    //   set({
    //     items: [...get().items, { ...item, id: tempId }],
    //     cartOperations: get().cartOperations + 1,
    //   })
    // }
    try {
      if (existing) {
        const updatedCartItem = await updateCartItemQuantity(
          existing.id,
          existing.quantity + 1,
        )
        set({
          items: get().items.map((i) =>
            i.id === updatedCartItem.id ? updatedCartItem : i,
          ),
        })
      } else {
        const newCartItem = await addItemToCart(item)
        set({ items: [...get().items, newCartItem] })
      }

      if (item?.offerId && !usersMembership?.isActive) {
        Toast.show({
          type: "error",
          text1: "Join our membership to redeem this awesome offer!",
          position: "bottom",
          visibilityTime: 5000,
          autoHide: true,
          bottomOffset: 90,
          props: {
            text1NumberOfLines: 0,
            text2NumberOfLines: 0, // allow wrapping
          },
        })
      }
      if (item?.loyaltyPointsUsed) {
        useLoyaltyStore.getState().fetchPoints()
        Toast.show({
          type: "success",
          text1: `${item.dessert.name} added to cart`,
          text2: `${item.loyaltyPointsUsed} points has been used`,
          position: "bottom",
          visibilityTime: 3000,
          autoHide: true,
          bottomOffset: 90,
          props: {
            text1NumberOfLines: 0,
            text2NumberOfLines: 0, // allow wrapping
          },
        })
      } else {
        Toast.show({
          type: "success",
          text1: `${item.dessert.name} added to cart`,
          position: "bottom",
          visibilityTime: 3000,
          autoHide: true,
          bottomOffset: 90,
          props: {
            text1NumberOfLines: 0,
            text2NumberOfLines: 0, // allow wrapping
          },
        })
      }
    } catch (error) {
      set({ cartOperations: get().cartOperations - 1 })
      if (item?.loyaltyPointsUsed) {
        console.error("Failed to order with loyalty points", error)
        Toast.show({
          type: "error",
          text1: "Failed to order with loyalty points",
          text2: `${error instanceof Error ? error.message : "An unknown error occurred"}`,
          position: "bottom",
          visibilityTime: 4000,
          autoHide: true,
          bottomOffset: 90,
          props: {
            text1NumberOfLines: 0,
            text2NumberOfLines: 0, // allow wrapping
          },
        })
      } else {
        // console.error("Failed to add item to cart", error)
        Toast.show({
          type: "error",
          text1: "Failed to add item to cart",
          text2: `${error instanceof Error ? error.message : "An unknown error occurred"}`,
          position: "bottom",
          visibilityTime: 4000,
          autoHide: true,
          bottomOffset: 90,
          props: {
            text1NumberOfLines: 0,
            text2NumberOfLines: 0, // allow wrapping
          },
        })
      }
    }
  },
  editItem: async (item) => {
    try {
      const { cartItem } = await updateCartItem(item)
      set({
        items: get().items.map((i) => (i.id === cartItem.id ? cartItem : i)),
      })
      Toast.show({
        type: "success",
        text1: `Your cart has been updated`,
        position: "bottom",
        visibilityTime: 2000,
        autoHide: true,
        bottomOffset: 90,
      })
    } catch (error) {
      console.error("Failed to edit item in cart", error)
      Toast.show({
        type: "error",
        text1: "Failed to edit item in cart",
        text2: `${error instanceof Error ? error.message : "An unknown error occurred"}`,
        position: "bottom",
        visibilityTime: 3000,
        autoHide: true,
        bottomOffset: 90,
        props: {
          text1NumberOfLines: 0,
          text2NumberOfLines: 0, // allow wrapping
        },
      })
    }
  },
  removeItem: async (id) => {
    const previousItems = get().items
    const item = get().items.find((i) => i.id === id)
    set({
      items: get().items.filter((i) => i.id !== id),
      error: null, // Clear error on successful removal
    })
    set({ cartOperations: get().cartOperations + 1 })
    try {
      await removeItemFromCart(id)
      set({ cartOperations: get().cartOperations - 1 })

      if (item?.loyaltyPointsUsed) {
        useLoyaltyStore.getState().fetchPoints()

        Toast.show({
          type: "success",
          text1: `Item removed from cart`,
          text2: `${item.loyaltyPointsUsed} points refunded`,
          position: "bottom",
          visibilityTime: 3000,
          autoHide: true,
          bottomOffset: 90,
          props: {
            text1NumberOfLines: 0,
            text2NumberOfLines: 0, // allow wrapping
          },
        })
      } else {
        Toast.show({
          type: "success",
          text1: `Item removed from cart`,
          position: "bottom",
          visibilityTime: 2000,
          autoHide: true,
          bottomOffset: 90,
        })
      }
    } catch (error) {
      console.error("Failed to remove item from cart", error)
      set({
        items: previousItems,
        error: "Failed to remove item",
      })
      set({ cartOperations: get().cartOperations - 1 })
      if (item?.loyaltyPointsUsed && item.loyaltyPointsUsed > 0) {
        useLoyaltyStore.getState().fetchPoints()
        console.error("Failed to restore points", error)
        Toast.show({
          type: "error",
          text1: `Failed to restore loyalty points (${item.loyaltyPointsUsed})`,
          text2: "Please contact eversweet@eversweet.co.nz",
          position: "bottom",
          visibilityTime: 0,
          autoHide: false,
          bottomOffset: 90,
          props: {
            text1NumberOfLines: 0,
            text2NumberOfLines: 0, // allow wrapping
          },
        })
      } else {
        Toast.show({
          type: "error",
          text1: "Failed to remove item from cart",
          text2: `${error instanceof Error ? error.message : "An unknown error occurred"}`,
          position: "bottom",
          visibilityTime: 3000,
          autoHide: true,
          bottomOffset: 90,
          props: {
            text1NumberOfLines: 0,
            text2NumberOfLines: 0, // allow wrapping
          },
        })
      }
    }
  },
  clearCart: async () => {
    const totalLoyaltyPointsUsed = get().items.reduce((total, item) => {
      return item.loyaltyPointsUsed ? total + item.loyaltyPointsUsed : total
    }, 0)

    try {
      set({ items: [], error: null })
      await clearCart()
      if (totalLoyaltyPointsUsed > 0) {
        useLoyaltyStore.getState().fetchPoints()

        Toast.show({
          type: "success",
          text1: `Cart has been cleared`,
          text2: `${totalLoyaltyPointsUsed} points refunded`,
          position: "bottom",
          visibilityTime: 3000,
          autoHide: true,
          bottomOffset: 90,
          props: {
            text1NumberOfLines: 0,
            text2NumberOfLines: 0, // allow wrapping
          },
        })
      } else {
        Toast.show({
          type: "success",
          text1: `Cart has been cleared`,
          position: "bottom",
          visibilityTime: 3000,
          autoHide: true,
          bottomOffset: 90,
        })
      }
    } catch (error) {
      console.error("Failed to clear cart", error)
      Toast.show({
        type: "error",
        text1: "Failed to clear cart",
        text2: `${error instanceof Error ? error.message : "An unknown error occurred"}`,
        position: "bottom",
        visibilityTime: 5000,
        autoHide: true,
        bottomOffset: 90,
        props: {
          text1NumberOfLines: 0,
          text2NumberOfLines: 0, // allow wrapping
        },
      })
    }
  },
  processOrder: async () => {
    set({ items: [], error: null })

    Toast.show({
      type: "success",
      text1: "Order Placed",
      text2: "Your order has been successfully placed.",
      position: "bottom",
      visibilityTime: 3000,
      autoHide: true,
      bottomOffset: 90,
      props: {
        text1NumberOfLines: 0,
        text2NumberOfLines: 0, // allow wrapping
      },
    })
  },
  incrementItem: async (id) => {
    set({
      items: get().items.map((i) =>
        i.id === id ? { ...i, quantity: i.quantity + 1 } : i,
      ),
    })
  },
  decrementItem: async (id) => {
    set({
      items: get().items.map((i) =>
        i.id === id ? { ...i, quantity: i.quantity - 1 } : i,
      ),
    })
  },
  updateCartItemQuantity: async (id, quantity) => {
    const requestId = Date.now() // or incrementing counter
    set({ lastRequestId: requestId })
    try {
      const updatedCartItem = await updateCartItemQuantity(id, quantity)

      // ❗ Ignore stale responses
      if (get().lastRequestId !== requestId) return

      set({
        items: get().items.map((i) =>
          i.id === updatedCartItem.id ? updatedCartItem : i,
        ),
      })
    } catch (error) {
      console.error("Failed to update cart item:", error)
    }
  },
  setError: (error) => set({ error }), // Action to set error
  getTotalItems: () =>
    get().items.reduce((acc, item) => acc + item.quantity, 0),
  getTotalCost: () =>
    get().items.reduce(
      (acc, item) =>
        acc +
        item.quantity *
          (item.itemPriceInCents -
            item.discountedAmountInCents +
            item.customisations.reduce(
              (acc, c) =>
                acc +
                (c.quantity > 0
                  ? (c.priceInCents - c.discountedAmountInCents) * c.quantity
                  : 0),
              0,
            )),
      0,
    ),
  getEarnablePoints: async (usersMembership: UsersMembership | null) => {
    const rates = await getLoyaltyRates()
    return get().items.reduce(
      (acc, item) =>
        acc +
        Math.floor(
          ((item.itemPriceInCents -
            item.discountedAmountInCents +
            item.customisations.reduce(
              (acc, c) =>
                acc +
                (c.quantity > 0
                  ? (c.priceInCents - c.discountedAmountInCents) * c.quantity
                  : 0),
              0,
            )) /
            100) * // points is calculated per dollar
            (rates.rate ?? 5) * // if !rates.rate ? fallback to 5 points per dollar
            item.quantity *
            (usersMembership?.isActive
              ? (rates.modifier ?? 1) * rates.memberRate // if !rates.modifier ? fallback to 1
              : (rates.modifier ?? 1)),
        ),
      0,
    )
  },
}))
