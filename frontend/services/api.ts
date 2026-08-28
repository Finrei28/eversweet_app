import {
  createAccountData,
  Customisation,
  AccountData,
  OrderStatus,
  AddCartItem,
  CartItem,
  DessertCategory,
  Offers,
  LoyaltyRates,
  Announcements,
  HomePageContent,
  RestaurantStatus,
  offerForClient,
  PrivacyPolicy,
  TermAndConditions,
  StoreHours,
  StoreInfo,
  LeaderBoard,
  UserLeaderBoardRank,
  UserDetails,
  LeaderBoardDetails,
  Menu,
  Order,
} from "@/utils/types"
import { format } from "date-fns"
import { getToken } from "./authToken"
import { getErrorMessage } from "@/utils/getError"

const url = process.env.EXPO_PUBLIC_URL!

export async function fetchCategoriesWithDesserts(): Promise<Menu> {
  const res = await fetch(`${url}/api/getMenu`)

  if (!res.ok) {
    throw new Error("Failed to fetch menu")
  }

  const data = await res.json()

  // Optionally filter if needed
  const filteredCategories = data.menu.filter(
    (category: DessertCategory) => category.desserts.length > 0,
  )
  return filteredCategories
}

export async function createAccount(formData: createAccountData) {
  if (
    !formData.email ||
    !formData.password ||
    !formData.firstName ||
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
      throw new Error(getErrorMessage(data))
    }

    if (!signUpRes.ok) {
      throw new Error("Failed to sign up, please try again later")
    }

    return data.firstName
  } catch (error) {
    throw new Error(getErrorMessage(error))
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
  signInProvider: (token: string) => Promise<void>, // pass from context
): Promise<{ name: string; emailVerified: boolean }> {
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

    // Handle when the rate limit triggers (HTTP 429)
    if (res.status === 429) {
      const errorData = await res.json()
      const resetTimeInSeconds = res.headers.get("RateLimit-Reset")
      const minutesLeft = Math.ceil(Number(resetTimeInSeconds) / 60)

      throw new Error(
        `${errorData.error} Try again in ${minutesLeft} minutes or reset your password.`,
      )
    }

    if (!res.ok) {
      // Handle normal validation errors (e.g. status 401 wrong password)
      const remaining = res.headers.get("RateLimit-Remaining")
      if (remaining !== null) {
        throw new Error(
          `Incorrect email or password. You have ${remaining} attempts remaining.`,
        )
      }
      throw new Error("Failed to sign in, please try again later.")
    }

    const data = await res.json()

    if (data.token) {
      await signInProvider(data.token) // Set token and user
    }

    return {
      name: data.name,
      emailVerified: data.emailVerified,
    } // Optionally return name or user data
  } catch (error) {
    throw new Error(getErrorMessage(error))
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
      throw new Error(getErrorMessage(data, "Network error occurred."))
    }

    if (!data.token) {
      throw new Error(
        "Verification succeeded but no session token was returned.",
      )
    }

    await signInProvider(data.token)
    return data.name
  } catch (error) {
    // 🌐 Network error or custom error
    throw new Error(getErrorMessage(error, "Network error occurred."))
  }
}

export async function getUserLoyaltyPoints(): Promise<number> {
  const token = await getToken()
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
      throw new Error(getErrorMessage(data))
    }
    return data.points
  } catch (error) {
    throw new Error(getErrorMessage(error))
  }
}

export async function getAvailableCustomisations(
  dessertId: string,
): Promise<Customisation[]> {
  try {
    const res = await fetch(
      `${url}/api/getAvailableCustomisations/${dessertId}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      },
    )

    if (!res.ok) {
      throw new Error(
        "Failed to retrieve customisations, please try again later",
      )
    }
    const data = await res.json()
    return data.customisations
  } catch (error) {
    throw new Error(getErrorMessage(error))
  }
}

// export async function restoreLoyaltyPoints(points: number) {
//   const token = await getToken()
//   if (!token) {
//     throw new Error("Unauthenticated")
//   }
//   try {
//     const res = await fetch(`${url}/api/auth/addLoyaltyPoints`, {
//       method: "PATCH",
//       headers: {
//         "Content-Type": "application/json",
//         Authorization: `Bearer ${token}`,
//       },
//       body: JSON.stringify({ points }),
//     })
//     if (res.status === 401) {
//       throw new Error("Unauthenticated")
//     }
//     if (res.status === 404) {
//       throw new Error("Failed to find your details, please try again later")
//     }
//     if (res.status === 400) {
//       throw new Error("Could not add points")
//     }
//     return true
//   } catch (error: any) {
//     throw new Error(error?.message || "Something went wrong.")
//   }
// }

// export async function orderWithLoyaltyPoints(points: number) {
//   const token = await getToken()
//   if (!token) {
//     throw new Error("Unauthenticated")
//   }

//   try {
//     const res = await fetch(`${url}/api/auth/orderWithLoyaltyPoints`, {
//       method: "PATCH",
//       headers: {
//         "Content-Type": "application/json",
//         Authorization: `Bearer ${token}`,
//       },
//       body: JSON.stringify({ points }),
//     })

//     const data = await res.json()

//     if (res.status === 401) {
//       throw new Error("Unauthenticated")
//     }
//     if (res.status === 404) {
//       throw new Error("Failed to find your details, please try again later")
//     }
//     if (res.status === 400) {
//       throw new Error("Insufficient points")
//     }
//     if (!res.ok) {
//       throw new Error(data?.message || "Server error. Please try again later.")
//     }
//     return data.loyaltyPoints
//   } catch (error: any) {
//     throw new Error(error?.message || "Something went wrong.")
//   }
// }

export async function getUserProfile(): Promise<UserDetails> {
  const token = await getToken()
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
      throw new Error(
        getErrorMessage(data, "Server error. Please try again later."),
      )
    }
    return data.user
  } catch (error) {
    throw new Error(getErrorMessage(error))
  }
}

export async function updateUserProfile(formData: AccountData) {
  const token = await getToken()
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
      throw new Error(
        getErrorMessage(data, "Server error. Please try again later."),
      )
    }
    return data.user
  } catch (error) {
    throw new Error(getErrorMessage(error))
  }
}

export async function updateAnonymousStatus(value: boolean): Promise<boolean> {
  const token = await getToken()
  if (!token) {
    throw new Error("Unauthenticated")
  }

  try {
    const res = await fetch(`${url}/api/auth/updateAnonymousStatus`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ value }),
    })

    const data = await res.json()

    if (!res.ok) {
      throw new Error(
        getErrorMessage(data, "Server error. Please try again later."),
      )
    }
    return data.value
  } catch (error) {
    throw new Error(getErrorMessage(error))
  }
}

export async function getUserOrders(status: OrderStatus): Promise<Order[]> {
  const token = await getToken()
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
      throw new Error(
        getErrorMessage(data, "Server error. Please try again later."),
      )
    }

    return data.orders
  } catch (error) {
    throw new Error(getErrorMessage(error))
  }
}

export async function createOrder(
  paymentMethodId: string | null,
  pickupNow: boolean,
  pickUpTime: Date,
  eatIn: boolean,
  paymentIntentId: string | null,
) {
  const token = await getToken()
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
        pickupNow,
        pickUpTime,
        eatIn,
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
      if (data?.orderId) {
        throw new Error("Order may have been created, please check your orders")
      }
      throw new Error(
        `${format(
          new Date(),
          "dd/MM/yyyy",
        )} Failed to send order to kitchen, please take a screenshot and contact support`,
      )
    }
    return data.order
  } catch (error) {
    throw new Error(getErrorMessage(error))
  }
}

export const sendOrderStatusNotification = async (
  orderId: string,
  orderNumber: string,
  newStatus: string,
) => {
  try {
    const token = await getToken()
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
    throw new Error(getErrorMessage(error))
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
      throw new Error(
        getErrorMessage(errorData, "Failed to check order status"),
      )
    }

    const data = await response.json()
    return data
  } catch (error) {
    console.error("Error checking order status:", error)
    throw new Error(getErrorMessage(error))
  }
}

export const getCartItems = async (): Promise<CartItem[]> => {
  const token = await getToken()
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
      throw new Error(getErrorMessage(data))
    }
    return data.cartItems
  } catch (error) {
    throw new Error(getErrorMessage(error))
  }
}

export const addItemToCart = async (item: AddCartItem): Promise<CartItem> => {
  const token = await getToken()
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
  } = item
  const cartItem = {
    dessertId: dessert.id,
    quantity,
    itemPriceInCents,
    customisations,
    loyaltyPointsUsed,
    offerId,
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
      throw new Error(getErrorMessage(data, "Failed to add item to cart"))
    }

    return data.cartItem
  } catch (error) {
    console.error("Error adding item to cart:", error)
    throw new Error(getErrorMessage(error))
  }
}

export const removeItemFromCart = async (itemId: string): Promise<string> => {
  const token = await getToken()
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
      throw new Error(getErrorMessage(data, "Failed to remove item from cart"))
    }

    return data.id
  } catch (error) {
    console.error("Error removing item from cart:", error)
    throw new Error(getErrorMessage(error))
  }
}

export const updateCartItem = async (
  item: CartItem,
): Promise<{ cartItem: CartItem }> => {
  const token = await getToken()
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
    offerId,
  } = item
  const updatedItem = {
    id,
    dessertId: dessert.id,
    quantity,
    customisations,
    itemPriceInCents,
    loyaltyPointsUsed,
    offerId,
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
      throw new Error(getErrorMessage(data, "Failed to update item in cart"))
    }

    return { cartItem: data.cartItem }
  } catch (error) {
    console.error("Error updating item in cart:", error)
    throw new Error(getErrorMessage(error))
  }
}

export const clearCart = async () => {
  const token = await getToken()
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
      throw new Error(getErrorMessage(data, "Failed to clear cart"))
    }
    return data
  } catch (error) {
    console.error("Error clearing cart:", error)
    throw new Error(getErrorMessage(error))
  }
}

// export const incrementCartItem = async (
//   itemId: string
// ): Promise<CartItem[]> => {
//   const token = await getToken()
//   if (!token) {
//     throw new Error("Please sign in to add item to cart")
//   }

//   try {
//     const res = await fetch(`${url}/api/cart/incrementCartItem`, {
//       method: "PATCH",
//       headers: {
//         "Content-Type": "application/json",
//         Authorization: `Bearer ${token}`,
//       },
//       body: JSON.stringify({ id: itemId }),
//     })

//     const data = await res.json()
//     if (!res.ok) {
//       throw new Error(data?.message || "Failed to increment cart item")
//     }

//     return data.cartItems
//   } catch (error) {
//     console.error("Error incrementing cart item:", error)
//     throw new Error(error?.message || "Something went wrong.")
//   }
// }

// export const decrementCartItem = async (
//   itemId: string
// ): Promise<CartItem[]> => {
//   const token = await getToken()
//   if (!token) {
//     throw new Error("Please sign in to take away an item from cart")
//   }
//   try {
//     const res = await fetch(`${url}/api/cart/decrementCartItem`, {
//       method: "PATCH",
//       headers: {
//         "Content-Type": "application/json",
//         Authorization: `Bearer ${token}`,
//       },
//       body: JSON.stringify({ id: itemId }),
//     })

//     const data = await res.json()
//     if (!res.ok) {
//       throw new Error(data?.message || "Failed to decrement cart item")
//     }

//     return data.cartItems
//   } catch (error) {
//     console.error("Error decrementing cart item:", error)
//     throw new Error(error?.message || "Something went wrong.")
//   }
// }

export const updateCartItemQuantity = async (
  itemId: string,
  quantity: number,
): Promise<CartItem> => {
  const token = await getToken()
  if (!token) {
    throw new Error("Please sign in to update item quantity in cart")
  }
  try {
    const res = await fetch(`${url}/api/cart/updateCartItemQuantity`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ id: itemId, quantity }),
    })

    const data = await res.json()
    if (!res.ok) {
      throw new Error(getErrorMessage(data, "Failed to update cart item"))
    }

    return data.cartItem
  } catch (error) {
    console.error("Error updating cart item:", error)
    throw new Error(getErrorMessage(error))
  }
}

export const showOffers = async (): Promise<Offers> => {
  const token = await getToken()
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
      throw new Error(getErrorMessage(data))
    }
    return data.offers
  } catch (error) {
    throw new Error(getErrorMessage(error))
  }
}

export const showOfferForClient = async (): Promise<offerForClient[]> => {
  try {
    const res = await fetch(`${url}/api/showOfferForClient`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    })

    const data = await res.json()
    if (!res.ok) {
      throw new Error(getErrorMessage(data))
    }

    return data.offers
  } catch (error) {
    throw new Error(getErrorMessage(error))
  }
}

export const getResetPasswordCode = async (email: string): Promise<boolean> => {
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
      throw new Error(getErrorMessage(data))
    }
    return data.success
  } catch (error) {
    throw new Error(getErrorMessage(error))
  }
}

export const resendVerificationCode = async (
  email: string,
): Promise<boolean> => {
  if (!email) {
    throw new Error("Email is required")
  }
  try {
    const res = await fetch(`${url}/api/auth/resendVerificationCode`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email }),
    })

    const data = await res.json()

    if (!res.ok) {
      throw new Error(getErrorMessage(data))
    }
    return data.success
  } catch (error) {
    throw new Error(getErrorMessage(error))
  }
}

export const verifyResetPasswordCode = async (email: string, OTP: string) => {
  if (!email) {
    throw new Error("Email is required")
  }
  if (!OTP) {
    throw new Error("Verification code is required")
  }
  try {
    const res = await fetch(`${url}/api/verifyResetPasswordCode`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, verificationCode: OTP }),
    })

    const data = await res.json()
    if (!res.ok) {
      throw new Error(getErrorMessage(data))
    }
    return data
  } catch (error) {
    throw new Error(getErrorMessage(error))
  }
}

export const resetPassword = async (
  email: string,
  newPassword: string,
  resetToken: string,
) => {
  if (!email) {
    throw new Error("Email is required")
  }
  if (!newPassword) {
    throw new Error("New password is required")
  }
  if (!resetToken) {
    throw new Error("Reset token is required")
  }
  try {
    const res = await fetch(`${url}/api/resetPassword`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, newPassword, resetToken }),
    })

    const data = await res.json()

    if (!res.ok) {
      throw new Error(getErrorMessage(data))
    }
    return data
  } catch (error) {
    throw new Error(getErrorMessage(error))
  }
}

export const getStoreHours = async (): Promise<StoreHours> => {
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
  } catch (error) {
    throw new Error(getErrorMessage(error))
  }
}

export const getStoreInfo = async (): Promise<StoreInfo> => {
  try {
    const res = await fetch(`${url}/api/getStoreInfo`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    })

    const data = await res.json()

    if (!res.ok) {
      throw new Error(`Error: Could not get store information`)
    }

    return data
  } catch (error) {
    throw new Error(getErrorMessage(error))
  }
}

export const getRestaurantStatus = async (): Promise<RestaurantStatus> => {
  try {
    const res = await fetch(`${url}/api/restaurantStatus`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    })
    const data = await res.json()

    if (!res.ok) {
      throw new Error(getErrorMessage(data, "Could not get restaurant status"))
    }

    return data.restaurantStatus
  } catch (error) {
    throw new Error(getErrorMessage(error, "Could not get restaurant status"))
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
    throw new Error(getErrorMessage(error, "Could not get loyalty rates"))
  }
}

export const getLeaderboardDetails = async (): Promise<LeaderBoardDetails> => {
  try {
    const res = await fetch(`${url}/api/getLeaderboardDetails`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    })

    if (!res.ok) {
      throw new Error(`Request failed with status ${res.status}`)
    }

    const data = await res.json()

    return data
  } catch (error) {
    throw new Error(getErrorMessage(error, "Could not get leaderboard details"))
  }
}

export const getAnnouncements = async (): Promise<Announcements> => {
  try {
    const res = await fetch(`${url}/api/getAnnouncements`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    })

    if (!res.ok) {
      throw new Error(`Request failed with status ${res.status}`)
    }

    const data = await res.json()

    return data
  } catch (error) {
    throw new Error(getErrorMessage(error, "Could not get announcements"))
  }
}

export const getHomepageCards = async (): Promise<HomePageContent[]> => {
  try {
    const res = await fetch(`${url}/api/getHomepageCards`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    })

    if (!res.ok) {
      throw new Error(`Request failed with status ${res.status}`)
    }

    const data = await res.json()

    return data
  } catch (error) {
    throw new Error(getErrorMessage(error, "Could not get home page contents"))
  }
}

export const getPrivacyPolicy = async (): Promise<PrivacyPolicy> => {
  try {
    const res = await fetch(`${url}/api/getPrivacyPolicy`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    })

    if (!res.ok) {
      throw new Error(`Request failed with status ${res.status}`)
    }

    const data = await res.json()

    return data
  } catch (error) {
    throw new Error(getErrorMessage(error, "Could not get privacy policy"))
  }
}

export const getTermAndConditions = async (): Promise<TermAndConditions> => {
  try {
    const res = await fetch(`${url}/api/getTermAndConditions`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    })

    if (!res.ok) {
      throw new Error(`Request failed with status ${res.status}`)
    }

    const data = await res.json()

    return data
  } catch (error) {
    throw new Error(
      getErrorMessage(error, "Could not get terms and conditions"),
    )
  }
}

export const getEstimatedPickUpTime = async (
  numOfItems: number,
): Promise<Date> => {
  try {
    if (numOfItems === 0) {
      return new Date()
    }
    const res = await fetch(`${url}/api/getEstimatedPickUpTime`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ numOfItems }),
    })

    if (!res.ok) {
      throw new Error(`Request failed with status ${res.status}`)
    }

    const data = await res.json()

    return new Date(data.estimatedTime)
  } catch (error) {
    throw new Error(getErrorMessage(error, "Could not get estimated time"))
  }
}

export const getLeaderBoard = async (): Promise<{
  leaderboard: LeaderBoard
  userRank: UserLeaderBoardRank
}> => {
  try {
    const token = await getToken()
    if (!token) {
      throw new Error("Please sign in to view the leaderboard")
    }
    const res = await fetch(`${url}/api/auth/getLeaderBoard`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    })

    if (!res.ok) {
      throw new Error(`Request failed with status ${res.status}`)
    }

    const data = await res.json()

    return data
  } catch (error) {
    throw new Error(getErrorMessage(error, "Could not get leaderboard"))
  }
}
