import { create } from "zustand"
import { AddCartItem, CartItem, UsersMembership } from "@/utils/types"

import {
  addItemToCart,
  clearCart,
  decrementCartItem,
  getCartItems,
  incrementCartItem,
  removeItemFromCart,
  updateCartItem,
} from "@/services/api"
import Toast from "react-native-toast-message"
import { useLoyaltyStore } from "./points"
import { useAuth } from "./authProvider"

interface CartState {
  items: CartItem[]
  error: string | null
  fetchCart: () => Promise<void>
  addItem: (item: AddCartItem) => Promise<void>
  editItem: (item: CartItem) => Promise<void>
  removeItem: (id: string) => Promise<void>
  clearCart: () => Promise<void>
  processOrder: () => Promise<void>
  incrementItem: (id: string) => Promise<void>
  decrementItem: (id: string) => Promise<void>
  setError: (error: string | null) => void
  getTotalItems: () => number
  getTotalCost: () => number
  getEarnablePoints: () => number
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  error: null,
  fetchCart: async () => {
    try {
      const { cartItems } = await getCartItems()
      set({ items: cartItems })
    } catch (error) {
      console.error("Failed to fetch cart items", error)
    }
  },
  addItem: async (item, usersMembership?: UsersMembership) => {
    try {
      await addItemToCart(item)
      const { cartItems } = await getCartItems()
      set({ items: cartItems })
      if (item?.offerId && !usersMembership?.isActive) {
        Toast.show({
          type: "error",
          text1: "Join our membership to redeem this awesome offer!",
          position: "bottom",
          visibilityTime: 5000,
          autoHide: true,
          bottomOffset: 60,
        })
      }
      if (item?.loyaltyPointsUsed) {
        const fetchPoints = useLoyaltyStore.getState().fetchPoints
        fetchPoints()
        Toast.show({
          type: "success",
          text1: `${item.dessert.name} added to cart`,
          text2: `${item.loyaltyPointsUsed} points has been used`,
          position: "bottom",
          visibilityTime: 3000,
          autoHide: true,
          bottomOffset: 60,
        })
      } else {
        Toast.show({
          type: "success",
          text1: `${item.dessert.name} added to cart`,
          position: "bottom",
          visibilityTime: 3000,
          autoHide: true,
          bottomOffset: 60,
        })
      }
    } catch (error) {
      if (item?.loyaltyPointsUsed) {
        console.error("Failed to order with loyalty points", error)
        Toast.show({
          type: "error",
          text1: "Failed to order with loyalty points",
          text2: `${error.message}`,
          position: "bottom",
          visibilityTime: 4000,
          autoHide: true,
          bottomOffset: 60,
        })
      } else {
        // console.error("Failed to add item to cart", error)
        Toast.show({
          type: "error",
          text1: "Failed to add item to cart",
          text2: `${error.message}`,
          position: "bottom",
          visibilityTime: 4000,
          autoHide: true,
          bottomOffset: 60,
        })
      }
    }

    // if (item?.loyaltyPointsUsed) {
    //   try {
    //     // Example: restore points via backend API
    //     await orderWithLoyaltyPoints(item.loyaltyPointsUsed)
    //     Toast.show({
    //       type: "success",
    //       text1: `${item.dessert.name} added to cart`,
    //       text2: `${item.loyaltyPointsUsed} points has been used`,
    //       position: "bottom",
    //       visibilityTime: 2000,
    //       autoHide: true,
    //       bottomOffset: 60,
    //     })
    //     const fetchPoints = useLoyaltyStore.getState().fetchPoints
    //     fetchPoints()
    //   } catch (error) {
    //     console.error("Failed to order with loyalty points", error)
    //     Toast.show({
    //       type: "error",
    //       text1: "Failed to order with loyalty points",
    //       text2: `${error.message}`,
    //       position: "bottom",
    //       visibilityTime: 3000,
    //       autoHide: true,
    //       bottomOffset: 60,
    //     })
    //     return
    //   }
    // }
    // const now = Date.now()

    // const areListsEqual = (
    //   list1: Customisations,
    //   list2: Customisations
    // ) => {
    //   if (list1.length !== list2.length) return false

    //   const sortedList1 = [...list1].sort((a, b) =>
    //     a.id.localeCompare(b.id)
    //   )
    //   const sortedList2 = [...list2].sort((a, b) =>
    //     a.id.localeCompare(b.id)
    //   )

    //   return sortedList1.every((item, index) =>
    //     isEqual(item, sortedList2[index])
    //   )
    // }

    // const existing = get().items.find(
    //   (i) =>
    //     i.dessert.id === item.dessert.id &&
    //     i.loyaltyPointsUsed === item.loyaltyPointsUsed &&
    //     areListsEqual(i.customisations, item.customisations)
    // )

    // if (existing) {
    //   set({
    //     items: get().items.map((i) =>
    //       i === existing ? { ...i, quantity: i.quantity + 1 } : i
    //     ),
    //     lastUpdated: now,
    //   })
    // } else {
    //   set({
    //     items: [...get().items, { ...item }],
    //     lastUpdated: now,
    //   })
    // }
  },
  editItem: async (item) => {
    try {
      const { cartItems } = await updateCartItem(item)
      set({ items: cartItems })
      Toast.show({
        type: "success",
        text1: `Your cart has been updated`,
        position: "bottom",
        visibilityTime: 2000,
        autoHide: true,
        bottomOffset: 60,
      })
    } catch (error) {
      console.error("Failed to edit item in cart", error)
      Toast.show({
        type: "error",
        text1: "Failed to edit item in cart",
        text2: `${error.message}`,
        position: "bottom",
        visibilityTime: 3000,
        autoHide: true,
        bottomOffset: 60,
      })
    }
    // const now = Date.now()
    // const existing = get().items.find((i) => i.id === item.id)

    // if (!existing) return
    // set({
    //   items: get().items.map((i) =>
    //     i.id === item.id ? { ...i, ...item } : i
    //   ),
    //   lastUpdated: now,
    // })
  },
  removeItem: async (id) => {
    const item = get().items.find((i) => i.id === id)
    try {
      set({
        items: get().items.filter((i) => i.id !== id),
        error: null, // Clear error on successful removal
      })
      const { cartItems } = await removeItemFromCart(id)
      // set({ items: cartItems })
      if (item.loyaltyPointsUsed) {
        const fetchPoints = useLoyaltyStore.getState().fetchPoints
        fetchPoints()
        Toast.show({
          type: "success",
          text1: `Item removed from cart`,
          text2: `${item.loyaltyPointsUsed} points refunded`,
          position: "bottom",
          visibilityTime: 3000,
          autoHide: true,
          bottomOffset: 60,
        })
      } else {
        Toast.show({
          type: "success",
          text1: `Item removed from cart`,
          position: "bottom",
          visibilityTime: 2000,
          autoHide: true,
          bottomOffset: 60,
        })
      }
    } catch (error) {
      console.error("Failed to remove item from cart", error)
      if (item.loyaltyPointsUsed && item.loyaltyPointsUsed > 0) {
        const fetchPoints = useLoyaltyStore.getState().fetchPoints
        fetchPoints()
        console.error("Failed to restore points", error)
        Toast.show({
          type: "error",
          text1: `Failed to restore loyalty points (${item.loyaltyPointsUsed})`,
          text2: "Please contact eversweet@eversweet.co.nz",
          position: "bottom",
          visibilityTime: 0,
          autoHide: false,
          bottomOffset: 60,
        })
      } else {
        Toast.show({
          type: "error",
          text1: "Failed to remove item from cart",
          text2: `${error.message}`,
          position: "bottom",
          visibilityTime: 3000,
          autoHide: true,
          bottomOffset: 60,
        })
      }
    }
    // const userId = await getUserIdFromToken()
    // // if (!userId) {
    // //   set({ error: "User not authenticated" })
    // //   return
    // // }

    // if (item?.loyaltyPointsUsed) {
    //   try {
    //     // Example: restore points via backend API
    //     await restoreLoyaltyPoints(item.loyaltyPointsUsed)
    //     Toast.show({
    //       type: "success",
    //       text1: `${item.loyaltyPointsUsed} points refunded`,
    //       position: "bottom",
    //       visibilityTime: 3000,
    //       autoHide: true,
    //       bottomOffset: 60,
    //     })
    //     const fetchPoints = useLoyaltyStore.getState().fetchPoints
    //     fetchPoints()
    //   } catch (error) {
    //     console.error("Failed to restore points", error)
    //     Toast.show({
    //       type: "error",
    //       text1: "Failed to restore loyalty points",
    //       text2: "Please contact eversweet@eversweet.co.nz",
    //       position: "bottom",
    //       visibilityTime: 4000,
    //       autoHide: true,
    //       bottomOffset: 60,
    //     })
    //     return
    //   }
    // }
  },
  clearCart: async () => {
    const totalLoyaltyPointsUsed = get().items.reduce((total, item) => {
      return item.loyaltyPointsUsed ? total + item.loyaltyPointsUsed : total
    }, 0)

    try {
      set({ items: [], error: null })
      await clearCart()
      if (totalLoyaltyPointsUsed > 0) {
        const fetchPoints = useLoyaltyStore.getState().fetchPoints
        fetchPoints()
        Toast.show({
          type: "success",
          text1: `Cart has been cleared`,
          text2: `${totalLoyaltyPointsUsed} points refunded`,
          position: "bottom",
          visibilityTime: 3000,
          autoHide: true,
          bottomOffset: 60,
        })
      } else {
        Toast.show({
          type: "success",
          text1: `Cart has been cleared`,
          position: "bottom",
          visibilityTime: 3000,
          autoHide: true,
          bottomOffset: 60,
        })
      }
    } catch (error) {
      console.error("Failed to clear cart", error)
      Toast.show({
        type: "error",
        text1: "Failed to clear cart",
        text2: `${error.message}`,
        position: "bottom",
        visibilityTime: 5000,
        autoHide: true,
        bottomOffset: 60,
      })
    }
  },
  processOrder: async () => {
    set({ items: [], error: null })
    await clearCart()

    Toast.show({
      type: "success",
      text1: "Order Placed",
      text2: "Your order has been successfully placed.",
      position: "bottom",
      visibilityTime: 3000,
      autoHide: true,
      bottomOffset: 60,
    })
  },
  incrementItem: async (id) => {
    try {
      set({
        items: get().items.map((i) =>
          i.id === id ? { ...i, quantity: i.quantity + 1 } : i
        ),
      })
      await incrementCartItem(id)
      // set({ items: cartItems })
    } catch (error) {
      console.error("Failed to increment cart item:", error)
    }
  },
  decrementItem: async (id) => {
    try {
      set({
        items: get().items.map((i) =>
          i.id === id ? { ...i, quantity: i.quantity - 1 } : i
        ),
      })
      await decrementCartItem(id)
      // set({ items: cartItems })
    } catch (error) {
      console.error("Failed to decrement cart item:", error)
    }
  },

  setError: (error) => set({ error }), // Action to set error
  getTotalItems: () =>
    get().items.reduce((acc, item) => acc + item.quantity, 0),
  getTotalCost: () =>
    get().items.reduce(
      (acc, item) => acc + item.quantity * item.itemPriceInCents,
      0
    ),
  getEarnablePoints: () => {
    const { usersMembership } = useAuth()

    if (usersMembership?.isActive) {
      return get().items.reduce(
        (acc, item) =>
          acc + Math.floor((item.itemPriceInCents / 10) * item.quantity * 2.2),
        0
      )
    }

    return get().items.reduce(
      (acc, item) =>
        acc + Math.floor((item.itemPriceInCents / 10) * item.quantity * 1.1),
      0
    )
  },
}))
