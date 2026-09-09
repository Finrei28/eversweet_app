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
  calculateMembershipDiscount,
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
  addItem: (
    item: AddCartItem,
    usersMembership?: UsersMembership | null,
  ) => Promise<void>
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
 * Marks a line that exists in the cart on this device but not yet on the
 * server. Nothing may be sent to the server about it until the add that
 * created it comes back with a real id.
 */
const PENDING_ID_PREFIX = "pending:"

let pendingSequence = 0
const nextPendingId = () => `${PENDING_ID_PREFIX}${++pendingSequence}`

export const isPendingCartItem = (id: string) => id.startsWith(PENDING_ID_PREFIX)

/**
 * Cart writes leave one at a time.
 *
 * The optimistic line appears immediately either way, so serialising costs the
 * customer nothing visible — but it means an add can never race another add.
 * Two quick adds of the same dessert would otherwise both match a line the
 * server has not acknowledged yet, and the second would send a placeholder id
 * the server has never seen; two adds from a customer with no cart would race
 * to create one. Queueing also lets each write re-read the cart when its turn
 * comes, by which point the write before it has landed.
 */
let cartWrites: Promise<unknown> = Promise.resolve()

const enqueueCartWrite = <T>(work: () => Promise<T>): Promise<T> => {
  const next = cartWrites.then(work, work)

  // The chain must not carry a rejection forward, or one failure would skip
  // every write queued behind it.
  cartWrites = next.then(
    () => undefined,
    () => undefined,
  )

  return next
}


const showAddedToast = (item: AddCartItem) => {
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

/**
 * Mirrors the server's calculateBestDiscount — the better of the membership
 * and promo discounts — closely enough that the cart total does not visibly
 * jump between the optimistic line appearing and the server's row replacing
 * it. The server remains the authority; this figure lives for about a second.
 */
const estimateDiscountInCents = (
  item: AddCartItem,
  usersMembership?: UsersMembership | null,
) => {
  const membershipDiscount = calculateMembershipDiscount(
    item.itemPriceInCents,
    usersMembership ?? null,
  )
  const promoDiscount = Math.max(
    0,
    item.dessert.priceInCents - calculatePriceAfterPromo(item.dessert),
  )

  return Math.max(membershipDiscount, promoDiscount)
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
  addItem: async (item, usersMembership) => {
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

    // Shown before the server has agreed to it — but only for a plain add.
    //
    // An offer redemption or a loyalty-point spend is refusable: a usage limit
    // reached, not enough points. Putting those in the cart first means taking
    // them back in front of the customer, and they are also the adds where the
    // server's answer carries information. Adding a dessert has no such
    // outcome, and it is the case people actually sit and wait through.
    const isPlainAdd = !item.offerId && !item.loyaltyPointsUsed

    // Only a line the server already knows about can be incremented — a
    // pending one has no id worth sending. Matching one anyway is how two
    // quick adds of the same dessert used to send a placeholder id and get a
    // 404 back.
    const confirmedMatch = get().items.find(
      (line) => !isPendingCartItem(line.id) && isSameLine(line),
    )

    let placeholderId: string | null = null

    if (isPlainAdd) {
      if (confirmedMatch) {
        set({
          items: get().items.map((line) =>
            line.id === confirmedMatch.id
              ? { ...line, quantity: line.quantity + 1 }
              : line,
          ),
        })
      } else {
        placeholderId = nextPendingId()
        set({
          items: [
            ...get().items,
            {
              ...item,
              id: placeholderId,
              discountedAmountInCents: estimateDiscountInCents(
                item,
                usersMembership,
              ),
            },
          ],
        })
      }

      showAddedToast(item)
    }

    return enqueueCartWrite(async () => {
      try {
        // Re-read now that the write queued ahead of this one has landed: the
        // line to merge into may only just have become one the server knows.
        const current = get().items
        const target = current.find(
          (line) =>
            line.id !== placeholderId &&
            !isPendingCartItem(line.id) &&
            isSameLine(line),
        )

        if (target) {
          const placeholder = placeholderId
            ? current.find((line) => line.id === placeholderId)
            : undefined

          // An absolute quantity. Whatever this add has already contributed
          // to the line on screen is in target.quantity; what has not been
          // applied locally still has to be added. A plain add that bumped
          // the line directly contributes nothing more here, one holding a
          // placeholder contributes the placeholder, and a redemption —
          // which is never applied optimistically — contributes its own
          // quantity.
          const outstanding = isPlainAdd
            ? (placeholder?.quantity ?? 0)
            : item.quantity

          const quantity = target.quantity + outstanding

          const updatedCartItem = await updateCartItemQuantity(
            target.id,
            quantity,
          )

          set({
            items: get()
              .items.filter((line) => line.id !== placeholderId)
              .map((line) =>
                line.id === updatedCartItem.id ? updatedCartItem : line,
              ),
          })
        } else {
          const newCartItem = await addItemToCart(item)

          set({
            items: placeholderId
              ? // Swap the placeholder for the server's row, which carries the
                // real id, price and discount.
                get().items.map((line) =>
                  line.id === placeholderId ? newCartItem : line,
                )
              : [...get().items, newCartItem],
          })
        }

        // There used to be a "join our membership" error toast here, fired on a
        // *successful* add whenever the user was not an active member. It was
        // already unreachable for the case it described — the server 403s that
        // add, so the catch below reports it — and now that offers can be open
        // to everyone it would scold a non-member for using one they are
        // entitled to. The server's own refusal message is the single source of
        // truth for why an offer was turned down.
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
        } else if (!isPlainAdd) {
          // The optimistic path already said so the moment the customer tapped.
          showAddedToast(item)
        }
      } catch (error) {
        // Undo this add and nothing else. Restoring a snapshot of the whole
        // cart would discard any add that was applied while this one was in
        // flight.
        if (isPlainAdd) {
          set({
            items: placeholderId
              ? get().items.filter((line) => line.id !== placeholderId)
              : get().items.map((line) =>
                  line.id === confirmedMatch?.id
                    ? { ...line, quantity: Math.max(1, line.quantity - 1) }
                    : line,
                ),
          })
        }

        if (item?.loyaltyPointsUsed) {
          console.error("Failed to order with loyalty points", error)
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
    // Still in flight. The add that created this line has not come back
    // with a real id yet, so there is nothing the server would recognise
    // to delete — and the pending row is about to be replaced anyway.
    if (isPendingCartItem(id)) return

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
  },
  clearCart: async () => {
    const previousItems = get().items
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
    // Inert until the line lands, so the count cannot drift from the row
    // the server is about to send back.
    if (isPendingCartItem(id)) return

    set({
      items: get().items.map((i) =>
        i.id === id ? { ...i, quantity: i.quantity + 1 } : i,
      ),
    })
  },
  decrementItem: async (id) => {
    // See incrementItem.
    if (isPendingCartItem(id)) return

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
    // See removeItem: a pending line has no server-side id to update.
    if (isPendingCartItem(id)) return

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
