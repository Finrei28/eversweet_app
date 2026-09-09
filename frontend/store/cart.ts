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
  removeItemFromCart,
  updateCartItem,
} from "@/services/api"
import Toast from "react-native-toast-message"
import { useLoyaltyStore } from "./points"
// Deep import: lodash's package entry is one monolithic CommonJS file and
// Metro does not tree-shake, so the named import pulled the whole library in.
import isEqual from "lodash/isEqual"
import {
  calculatePriceAfterMembershipDiscount,
  calculatePriceAfterPromo,
} from "@/lib/priceHelper"
import { getErrorMessage } from "@/utils/getError"
import { fetchLoyaltyRates } from "@/services/queries"

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

// Net price of one unit of a cart item, discounts applied, in cents. Only
// customisations with a positive quantity are charged — quantity 0 means the
// customer removed an ingredient the dessert normally includes.
const netUnitPriceInCents = (item: CartItem) =>
  item.itemPriceInCents -
  item.discountedAmountInCents +
  item.customisations.reduce(
    (acc, c) =>
      acc +
      (c.quantity > 0
        ? (c.priceInCents - c.discountedAmountInCents) * c.quantity
        : 0),
    0,
  )

/**
 * Cart writes leave one at a time.
 *
 * An add can never race another add or a removal. Two adds from a customer
 * with no cart would otherwise race to create one, and an add overlapping a
 * removal takes the same rows in the opposite order on the server, which
 * deadlocked. Queueing also lets each write read the cart when its turn comes,
 * by which point the write before it has landed.
 */
let cartWrites: Promise<unknown> = Promise.resolve()

/**
 * Resolves when everything queued so far has settled.
 *
 * Checkout waits on this before reading the cart back from the server. The
 * quantity buttons apply their change locally and sync it after a debounce, so
 * without this the customer can reach checkout while their last tap is still
 * in the air, and be charged for the quantity they had before it.
 */
export const whenCartWritesSettle = () => cartWrites

const countWrite = (delta: number) =>
  useCartStore.setState((state) => ({
    cartOperations: state.cartOperations + delta,
  }))

const enqueueCartWrite = <T>(work: () => Promise<T>): Promise<T> => {
  // Counted from the moment it is queued, so `cartOperations` means "cart
  // writes in flight" for every write rather than only for removals. Checkout
  // refuses to refetch while it is above zero, and an add that did not count
  // itself is how an item could be dropped on the way there.
  countWrite(1)

  const next = cartWrites.then(work, work)

  // The chain must not carry a rejection forward, or one failure would skip
  // every write queued behind it.
  cartWrites = next.then(
    () => undefined,
    () => undefined,
  )

  void next.then(
    () => countWrite(-1),
    () => countWrite(-1),
  )

  return next
}

const showAddedToast = (item: AddCartItem) => {
  Toast.show({
    type: "success",
    text1: `${item.dessert.name} added to cart`,
    // Said at the same moment as the rest, so a redemption gets one message
    // rather than a generic one now and the points one a round trip later.
    text2: item.loyaltyPointsUsed
      ? `${item.loyaltyPointsUsed} points has been used`
      : undefined,
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
  addItem: async (item) => {
    const areListsEqual = (list1: Customisations, list2: Customisations) => {
      if (list1.length !== list2.length) return false

      const sortedList1 = [...list1].sort((a, b) => a.id.localeCompare(b.id))
      const sortedList2 = [...list2].sort((a, b) => a.id.localeCompare(b.id))

      return sortedList1.every((item, index) =>
        isEqual(item, sortedList2[index]),
      )
    }

    const isSameLine = (line: CartItem) =>
      line.dessert.id === item.dessert.id &&
      line.loyaltyPointsUsed === item.loyaltyPointsUsed &&
      line.offerId === item.offerId &&
      Math.round(line.itemPriceInCents) === Math.round(item.itemPriceInCents) &&
      areListsEqual(line.customisations, item.customisations)

    // Nothing goes into the cart until the server has agreed to it.
    //
    // This was optimistic for a while, and it did not survive contact with a
    // backend that takes four to five seconds to answer. Optimistic UI assumes
    // the customer cannot act inside the confirmation window; at five seconds
    // they act inside it constantly, and every button then has to defend
    // itself against a line the server has never heard of. The one that got
    // away was worse than dead buttons: checkout refetched the cart mid-add
    // and the item vanished on the way to being paid for.
    //
    // The wait is the real problem and it belongs in the backend, not behind a
    // guess about what the backend is going to say.
    //
    // A redemption is never merged into an existing line. A quantity change
    // redeems nothing and debits nothing, so merging one handed out free
    // desserts; the server refuses it outright now.
    const isPlainAdd = !item.offerId && !item.loyaltyPointsUsed

    return enqueueCartWrite(async () => {
      try {
        // Read when the turn comes rather than when the tap happened, so a
        // line added by the write queued ahead of this one is visible here.
        const target = isPlainAdd ? get().items.find(isSameLine) : undefined

        if (target) {
          const updatedCartItem = await updateCartItemQuantity(
            target.id,
            target.quantity + item.quantity,
          )

          set({
            items: get().items.map((line) =>
              line.id === updatedCartItem.id ? updatedCartItem : line,
            ),
          })
        } else {
          const newCartItem = await addItemToCart(item)

          set({ items: [...get().items, newCartItem] })
        }

        // There used to be a "join our membership" error toast here, fired on a
        // *successful* add whenever the user was not an active member. It was
        // already unreachable for the case it described — the server 403s that
        // add, so the catch below reports it — and now that offers can be open
        // to everyone it would scold a non-member for using one they are
        // entitled to. The server's own refusal message is the single source of
        // truth for why an offer was turned down.
        showAddedToast(item)

        if (item.loyaltyPointsUsed) {
          // Awaited: the balance on screen is only ever the server's answer
          // now, and the customer is looking at it.
          await useLoyaltyStore.getState().fetchPoints()
        }
      } catch (error) {
        // Nothing was applied, so there is nothing to undo.
        if (item?.loyaltyPointsUsed) {
          console.error("Failed to order with loyalty points", error)
          await useLoyaltyStore.getState().fetchPoints()
          Toast.show({
            type: "error",
            text1: "Failed to order with loyalty points",
            text2: `${getErrorMessage(error, "An unknown error occurred")}`,
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
          Toast.show({
            type: "error",
            text1: "Failed to add item to cart",
            text2: `${getErrorMessage(error, "An unknown error occurred")}`,
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
    })
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
        text2: `${getErrorMessage(error, "An unknown error occurred")}`,
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
    // Queued with the adds. A remove and an add in flight together take the
    // same rows in opposite orders on the server and used to deadlock each
    // other; the line has already gone from the list here, so waiting a turn
    // costs the customer nothing they can see.
    return enqueueCartWrite(async () => {
      try {
        await removeItemFromCart(id)

        if (item?.loyaltyPointsUsed) {
          await useLoyaltyStore.getState().fetchPoints()

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
        if (item?.loyaltyPointsUsed && item.loyaltyPointsUsed > 0) {
          await useLoyaltyStore.getState().fetchPoints()
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
            text2: `${getErrorMessage(error, "An unknown error occurred")}`,
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
    })
  },
  clearCart: async () => {
    const previousItems = get().items
    const totalLoyaltyPointsUsed = get().items.reduce((total, item) => {
      return item.loyaltyPointsUsed ? total + item.loyaltyPointsUsed : total
    }, 0)

    // Same queue as the adds and removes: clearing takes the same rows.
    set({ items: [], error: null })

    return enqueueCartWrite(async () => {
      try {
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
        // The list was emptied optimistically; the server still holds these
        // items, so put them back instead of showing an empty cart.
        set({ items: previousItems, error: "Failed to clear cart" })
        Toast.show({
          type: "error",
          text1: "Failed to clear cart",
          text2: `${getErrorMessage(error, "An unknown error occurred")}`,
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
    })
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
        // Floored at one: removing the last one is `removeItem`, and only the
        // button's disabled state stopped a zero or negative quantity being
        // sent to the server.
        i.id === id ? { ...i, quantity: Math.max(1, i.quantity - 1) } : i,
      ),
    })
  },
  updateCartItemQuantity: async (id, quantity) => {
    // A counter rather than Date.now(): two taps inside the same millisecond
    // produced identical ids, so neither response counted as stale. Claimed
    // before queueing, so the newest tap still wins even if an earlier one is
    // still waiting its turn.
    const requestId = (get().lastRequestId ?? 0) + 1
    set({ lastRequestId: requestId })

    // Queued with the adds: an add merging into this same line also sends an
    // absolute quantity, and the two must not overlap.
    return enqueueCartWrite(async () => {
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

        if (get().lastRequestId !== requestId) return

        // incrementItem/decrementItem already applied the new quantity locally,
        // so the cart is now ahead of the server. Pull the server's copy back
        // rather than letting the customer check out against a quantity that was
        // never saved.
        await get().fetchCart()

        Toast.show({
          type: "error",
          text1: "Couldn't update the quantity",
          text2: getErrorMessage(error, "Your cart has been refreshed."),
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
    })
  },

  setError: (error) => set({ error }), // Action to set error
  getTotalItems: () =>
    get().items.reduce((acc, item) => acc + item.quantity, 0),
  getTotalCost: () =>
    get().items.reduce(
      (acc, item) => acc + item.quantity * netUnitPriceInCents(item),
      0,
    ),
  getEarnablePoints: async (usersMembership: UsersMembership | null) => {
    // Cached: incrementing or decrementing an item re-runs this, and the
    // uncached version put a request on the wire for every tap.
    const rates = await fetchLoyaltyRates()
    return get().items.reduce(
      (acc, item) =>
        acc +
        Math.floor(
          (netUnitPriceInCents(item) / 100) * // points is calculated per dollar
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
