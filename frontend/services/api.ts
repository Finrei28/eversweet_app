import {
  createAccountData,
  Customisation,
  AccountData,
  OrderStatus,
  AddCartItem,
  CartItem,
  DessertCategory,
  Offers,
  restaurantStatus,
  LoyaltyRates,
} from "@/utils/types"
import * as SecureStore from "expo-secure-store"
import { Menu, Order } from "@/utils/types"
import { format } from "date-fns"
import { getToken } from "./authToken"

const url = process.env.EXPO_PUBLIC_URL!

export async function fetchCategoriesWithDesserts(): Promise<Menu> {
  const res = await fetch(`${url}/api/getMenu`)

  if (!res.ok) {
    throw new Error("Failed to fetch menu")
  }

  const data = await res.json()

  // Optionally filter if needed
  const filteredCategories = data.menu.filter(
    (category: DessertCategory) => category.desserts.length > 0
  )
  return filteredCategories
}

export async function createAccount(formData: createAccountData) {
  // Only proceed if the sign-up was successful and user exists
  if (
    !formData.email &&
    !formData.password &&
    !formData.firstName &&
    !formData.lastName
  ) {
    throw new Error("Email, password, and name are required.")
  }

  try {
    const signUpRes = await fetch(`${url}/api/auth/signup`, {
      method: "POST",
      body: JSON.stringify(formData),
      headers: {
        "Content-Type": "application/json",
      },
    })
    const data = await signUpRes.json()

    if (signUpRes.status === 400) {
      throw new Error(data.message)
    }

    if (!signUpRes.ok) {
      throw new Error("Failed to sign up, please try again later")
    }

    return data.firstName
  } catch (error: any) {
    throw new Error(error?.message || "Something went wrong.")
  }
}

export async function signIn(
  {
    email,
    password,
  }: {
    email: string
    password: string
  },
  signInProvider: (token: string) => Promise<void> // pass from context
): Promise<string> {
  if (!email || !password) {
    throw new Error("Email and password are required.")
  }

  try {
    const res = await fetch(`${url}/api/auth/signin`, {
      method: "POST",
      body: JSON.stringify({ email, password }),
      headers: {
        "Content-Type": "application/json",
      },
    })

    const data = await res.json()

    if (res.status === 401) {
      throw new Error("Incorrect email or password.")
    }

    if (!res.ok) {
      throw new Error("Failed to sign in, please try again later.")
    }

    await signInProvider(data.token) // Set token and user
    return data.name // Optionally return name or user data
  } catch (error: any) {
    throw new Error(error?.message || "Something went wrong.")
  }
}

export async function checkVerificationCode({
  email,
  verificationCode,
  signInProvider,
}: {
  email: string
  verificationCode: string
  signInProvider: (token: string) => Promise<void>
}) {
  try {
    const res = await fetch(`${url}/api/auth/checkVerificationCode`, {
      method: "POST",
      body: JSON.stringify({ verificationCode, email }),
      headers: {
        "Content-Type": "application/json",
      },
    })
    const data = await res.json()

    if (!res.ok) {
      throw new Error(`Error: ${data.message}`)
    }

    await signInProvider(data.token)
    return data.name
  } catch (error: any) {
    // 🌐 Network error or custom error
    throw new Error(error.message || "Network error occurred.")
  }
}

export async function getUserLoyaltyPoints(): Promise<number> {
  const token = await SecureStore.getItemAsync("token")
  if (!token) {
    throw new Error("Unauthenticated")
  }
  try {
    const res = await fetch(`${url}/api/auth/getUserLoyaltyPoints`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    })
    const data = await res.json()
    if (res.status === 401) {
      throw new Error("Unauthenticated")
    }
    if (!res.ok) {
      throw new Error(`Error: ${data.message}`)
    }
    return data.loyaltyPoints.points
  } catch (error: any) {
    throw new Error(error?.message || "Something went wrong.")
  }
}

export async function getAvailableCustomisations(
  dessertId: string
): Promise<Customisation[]> {
  try {
    const res = await fetch(
      `${url}/api/getAvailableCustomisations/${dessertId}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      }
    )

    if (!res.ok) {
      throw new Error(
        "Failed to retrieve customisations, please try again later"
      )
    }
    const data = await res.json()
    return data.customisations
  } catch (error: any) {
    throw new Error(error?.message || "Something went wrong.")
  }
}

export async function restoreLoyaltyPoints(points: number) {
  const token = await SecureStore.getItemAsync("token")
  if (!token) {
    throw new Error("Unauthenticated")
  }
  try {
    const res = await fetch(`${url}/api/auth/addLoyaltyPoints`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ points }),
    })
    if (res.status === 401) {
      throw new Error("Unauthenticated")
    }
    if (res.status === 404) {
      throw new Error("Failed to find your details, please try again later")
    }
    if (res.status === 400) {
      throw new Error("Could not add points")
    }
    return true
  } catch (error: any) {
    throw new Error(error?.message || "Something went wrong.")
  }
}

export async function orderWithLoyaltyPoints(points: number) {
  const token = await SecureStore.getItemAsync("token")
  if (!token) {
    throw new Error("Unauthenticated")
  }

  try {
    const res = await fetch(`${url}/api/auth/orderWithLoyaltyPoints`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ points }),
    })

    const data = await res.json()

    if (res.status === 401) {
      throw new Error("Unauthenticated")
    }
    if (res.status === 404) {
      throw new Error("Failed to find your details, please try again later")
    }
    if (res.status === 400) {
      throw new Error("Insufficient points")
    }
    if (!res.ok) {
      throw new Error(data?.message || "Server error. Please try again later.")
    }
    return data.loyaltyPoints
  } catch (error: any) {
    throw new Error(error?.message || "Something went wrong.")
  }
}

export async function getUserProfile() {
  const token = await SecureStore.getItemAsync("token")
  if (!token) {
    throw new Error("Unauthenticated")
  }
  try {
    const res = await fetch(`${url}/api/auth/getUser`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    })

    const data = await res.json()

    if (res.status === 404) {
      throw new Error("Failed to find your details, please try again later")
    }
    if (!res.ok) {
      throw new Error(data?.message || "Server error. Please try again later.")
    }
    return data.user
  } catch (error: any) {
    throw new Error(error?.message || "Something went wrong.")
  }
}

export async function updateUserProfile(formData: AccountData) {
  const token = await SecureStore.getItemAsync("token")
  if (!token) {
    throw new Error("Unauthenticated")
  }

  try {
    const res = await fetch(`${url}/api/auth/updateUser`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(formData),
    })

    const data = await res.json()

    if (res.status === 404) {
      throw new Error("Failed to find your details, please try again later")
    }
    if (!res.ok) {
      throw new Error(data?.message || "Server error. Please try again later.")
    }
    return data.user
  } catch (error: any) {
    throw new Error(error?.message || "Something went wrong.")
  }
}

export async function getUserOrders(status: OrderStatus): Promise<Order[]> {
  const token = await SecureStore.getItemAsync("token")
  if (!token) {
    throw new Error("Please sign in to view your orders")
  }

  try {
    const res = await fetch(`${url}/api/auth/getUserOrders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status }),
    })

    const data = await res.json()
    if (res.status === 404) {
      throw new Error("Failed to find your details, please try again later")
    }
    if (!res.ok) {
      throw new Error(data?.message || "Server error. Please try again later.")
    }

    return data.orders
  } catch (error: any) {
    throw new Error(error?.message || "Something went wrong.")
  }
}

export async function createOrder(
  paymentMethodId: string | null,
  pickUpTime: Date,
  dineIn: boolean,
  paymentIntentId: string | null
) {
  const token = await SecureStore.getItemAsync("token")
  if (!token) {
    throw new Error("Unauthenticated")
  }

  try {
    const res = await fetch(`${url}/api/auth/createOrder`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        paymentMethodId,
        pickUpTime,
        dineIn,
        paymentIntentId,
      }),
    })

    const data = await res.json()

    if (res.status === 401) {
      throw new Error("Please sign in to place an order")
    }

    if (res.status === 400) {
      throw new Error("Failed to create order, please try again later")
    }

    if (!res.ok) {
      try {
        const errorData = data
        if (errorData.orderId) {
          throw new Error(
            "Order may have been created, please check your orders"
          )
        }
      } catch (parseError) {
        // If we can't parse the response, just throw a generic error
      }
      throw new Error(
        `${format(
          new Date(),
          "dd/MM/yyyy"
        )} Failed to send order to kitchen, please take a screenshot and contact support`
      )
    }
    return data.order
  } catch (error: any) {
    throw new Error(error?.message || "Something went wrong.")
  }
}

export const sendOrderStatusNotification = async (
  orderId: string,
  orderNumber: string,
  newStatus: string
) => {
  try {
    const token = await SecureStore.getItemAsync("token")
    if (!token) {
      throw new Error("Unauthenticated")
    }
    const response = await fetch(`${url}/api/notification/orderStatusChange`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        orderId,
        orderNumber,
        newStatus,
      }),
    })

    if (!response.ok) {
      throw new Error("Failed to send notification")
    }

    return await response.json()
  } catch (error) {
    console.error("Error sending order status notification:", error)
    throw new Error(error?.message || "Something went wrong.")
  }
}

export const checkOrderStatus = async (orderId: string) => {
  try {
    const token = await getToken()
    if (!token) {
      throw new Error("Please sign in to check order status")
    }

    const response = await fetch(`${url}/api/auth/orderStatus/${orderId}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.message || "Failed to check order status")
    }

    const data = await response.json()
    return data
  } catch (error) {
    console.error("Error checking order status:", error)
    throw new Error(error?.message || "Something went wrong.")
  }
}

export const getCartItems = async (): Promise<CartItem[]> => {
  const token = await SecureStore.getItemAsync("token")
  if (!token) {
    throw new Error("Please sign in to see your cart")
  }
  try {
    const res = await fetch(`${url}/api/cart/getCartItems`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    })

    const data = await res.json()
    if (res.status === 401) {
      throw new Error("Unauthenticated")
    }
    if (!res.ok) {
      throw new Error(`Error: ${data.message}`)
    }
    return data.cartItems
  } catch (error: any) {
    throw new Error(error?.message || "Something went wrong.")
  }
}

export const addItemToCart = async (item: AddCartItem): Promise<CartItem[]> => {
  const token = await SecureStore.getItemAsync("token")
  if (!token) {
    throw new Error("Please sign in to add item")
  }

  const {
    dessert,
    quantity,
    itemPriceInCents,
    customisations,
    loyaltyPointsUsed,
    offerId,
    discountedAmountInCents,
  } = item
  const cartItem = {
    dessertId: dessert.id,
    quantity,
    itemPriceInCents,
    customisations,
    loyaltyPointsUsed,
    offerId,
    discountedAmountInCents,
  }

  try {
    const res = await fetch(`${url}/api/cart/addItemToCart`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(cartItem),
    })

    const data = await res.json()

    if (res.status === 401) {
      throw new Error("Please sign in to add items to cart")
    }

    if (!res.ok) {
      throw new Error(data?.message || "Failed to add item to cart")
    }

    return data.cartItems
  } catch (error) {
    console.error("Error adding item to cart:", error)
    throw new Error(error?.message || "Something went wrong.")
  }
}

export const removeItemFromCart = async (
  itemId: string
): Promise<CartItem[]> => {
  const token = await SecureStore.getItemAsync("token")
  if (!token) {
    throw new Error("Please sign in to remove item from cart")
  }

  try {
    const res = await fetch(`${url}/api/cart/removeItemFromCart/${itemId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    const data = await res.json()

    if (!res.ok) {
      throw new Error(data?.message || "Failed to remove item from cart")
    }

    return data.cartItems
  } catch (error) {
    console.error("Error removing item from cart:", error)
    throw new Error(error?.message || "Something went wrong.")
  }
}

export const updateCartItem = async (
  item: CartItem
): Promise<{ cartItems: CartItem[] }> => {
  const token = await SecureStore.getItemAsync("token")
  if (!token) {
    throw new Error("Please sign in to update your cart")
  }

  const {
    id,
    dessert,
    quantity,
    customisations,
    itemPriceInCents,
    loyaltyPointsUsed,
    discountedAmountInCents,
  } = item
  const updatedItem = {
    id,
    dessertId: dessert.id,
    quantity,
    customisations,
    itemPriceInCents,
    loyaltyPointsUsed,
    discountedAmountInCents,
  }

  try {
    const res = await fetch(`${url}/api/cart/updateCartItem`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(updatedItem),
    })

    const data = await res.json()

    if (!res.ok) {
      throw new Error(data?.message || "Failed to update item in cart")
    }

    return { cartItems: data.cartItems }
  } catch (error) {
    console.error("Error updating item in cart:", error)
    throw new Error(error?.message || "Something went wrong.")
  }
}

export const clearCart = async () => {
  const token = await SecureStore.getItemAsync("token")
  if (!token) {
    throw new Error("Unauthenticated")
  }
  try {
    const res = await fetch(`${url}/api/cart/clearCart`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
    const data = await res.json()
    if (!res.ok) {
      throw new Error(data?.message || "Failed to clear cart")
    }
    return data
  } catch (error) {
    console.error("Error clearing cart:", error)
    throw new Error(error?.message || "Something went wrong.")
  }
}

export const incrementCartItem = async (
  itemId: string
): Promise<CartItem[]> => {
  const token = await SecureStore.getItemAsync("token")
  if (!token) {
    throw new Error("Please sign in to add item to cart")
  }

  try {
    const res = await fetch(`${url}/api/cart/incrementCartItem`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ id: itemId }),
    })

    const data = await res.json()
    if (!res.ok) {
      throw new Error(data?.message || "Failed to increment cart item")
    }

    return data.cartItems
  } catch (error) {
    console.error("Error incrementing cart item:", error)
    throw new Error(error?.message || "Something went wrong.")
  }
}

export const decrementCartItem = async (
  itemId: string
): Promise<CartItem[]> => {
  const token = await SecureStore.getItemAsync("token")
  if (!token) {
    throw new Error("Please sign in to take away an item from cart")
  }
  try {
    const res = await fetch(`${url}/api/cart/decrementCartItem`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ id: itemId }),
    })

    const data = await res.json()
    if (!res.ok) {
      throw new Error(data?.message || "Failed to decrement cart item")
    }

    return data.cartItems
  } catch (error) {
    console.error("Error decrementing cart item:", error)
    throw new Error(error?.message || "Something went wrong.")
  }
}

export const showOffers = async (): Promise<Offers> => {
  const token = await SecureStore.getItemAsync("token")
  if (!token) {
    throw new Error("Please sign in to see membership offers")
  }
  try {
    const res = await fetch(`${url}/api/auth/showOffers`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    })

    const data = await res.json()
    if (res.status === 401) {
      throw new Error("Unauthenticated")
    }
    if (!res.ok) {
      throw new Error(`Error: ${data.message}`)
    }
    return data.offers
  } catch (error: any) {
    throw new Error(error?.message || "Something went wrong.")
  }
}

export const getResetPasswordCode = async (email: string) => {
  if (!email) {
    throw new Error("Email is required")
  }
  try {
    const res = await fetch(`${url}/api/getResetPasswordCode`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email }),
    })

    const data = await res.json()

    if (!res.ok) {
      throw new Error(`Error: ${data.message}`)
    }
    return data
  } catch (error: any) {
    throw new Error(error?.message || "Something went wrong.")
  }
}

export const verifyResetPasswordCode = async (
  email: string,
  verificationCode: string
) => {
  if (!email) {
    throw new Error("Email is required")
  }
  if (!verificationCode) {
    throw new Error("Verification code is required")
  }
  try {
    const res = await fetch(`${url}/api/verifyResetPasswordCode`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, verificationCode }),
    })

    const data = await res.json()
    if (!res.ok) {
      throw new Error(`Error: ${data.message}`)
    }
    return data
  } catch (error: any) {
    throw new Error(error?.message || "Something went wrong.")
  }
}

export const resetPassword = async (email: string, newPassword: string) => {
  if (!email) {
    throw new Error("Email is required")
  }
  if (!newPassword) {
    throw new Error("New password is required")
  }
  try {
    const res = await fetch(`${url}/api/resetPassword`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, newPassword }),
    })

    const data = await res.json()

    if (!res.ok) {
      throw new Error(`Error: ${data.message}`)
    }
    return data
  } catch (error: any) {
    throw new Error(error?.message || "Something went wrong.")
  }
}

export const getStoreHours = async () => {
  try {
    const res = await fetch(`${url}/api/getStoreHours`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    })

    const data = await res.json()

    if (!res.ok) {
      throw new Error(`Error: Could not get store hours`)
    }

    return data
  } catch (error: any) {
    throw new Error(error?.message || "Something went wrong.")
  }
}

export const getRestaurantStatus = async (): Promise<restaurantStatus> => {
  try {
    const res = await fetch(`${url}/api/restaurantStatus`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    })
    const data = await res.json()

    if (!res.ok) {
      throw new Error(`Error: ${data.message}`)
    }

    return data.restaurantStatus
  } catch (error) {
    throw new Error(error?.message || "Could not get restaurant status")
  }
}

export const getLoyaltyRates = async (): Promise<LoyaltyRates> => {
  try {
    const res = await fetch(`${url}/api/getLoyaltyRates`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    })
    const data = await res.json()

    if (!res.ok) {
      throw new Error(`Error: Could not get loyalty rates`)
    }

    return data
  } catch (error) {
    throw new Error(error?.message || "Could not get loyalty rates")
  }
}
