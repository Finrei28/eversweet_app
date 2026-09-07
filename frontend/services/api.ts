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
import { formatDayStamp } from "@/lib/formatters"
import { normaliseStoreHours } from "@/lib/businessHours"
import { getErrorMessage } from "@/utils/getError"
import { apiFetch, apiRequest } from "./apiClient"

// Messages used by more than one endpoint.
const UNAUTHENTICATED = "Unauthenticated"
const DETAILS_NOT_FOUND = "Failed to find your details, please try again later"
const SERVER_ERROR = "Server error. Please try again later."

export async function fetchCategoriesWithDesserts(): Promise<Menu> {
  const data = await apiRequest<{ menu: Menu }>("/api/getMenu", {
    errorMessage: "Failed to fetch menu",
  })

  // Optionally filter if needed
  return data.menu.filter(
    (category: DessertCategory) => category.desserts.length > 0,
  )
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

  // A 400 carries a specific validation message worth showing; anything else
  // is generic, so this can't go through apiRequest's single-message model.
  const { res, data } = await apiFetch("/api/auth/signup", {
    method: "POST",
    body: formData,
  })

  if (res.status === 400) {
    throw new Error(getErrorMessage(data))
  }

  if (!res.ok) {
    throw new Error("Failed to sign up, please try again later")
  }

  return data.firstName
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

  const { res, data } = await apiFetch("/api/auth/signin", {
    method: "POST",
    body: { email, password },
  })

  // Handle when the rate limit triggers (HTTP 429)
  if (res.status === 429) {
    const resetTimeInSeconds = res.headers.get("RateLimit-Reset")
    const minutesLeft = Math.ceil(Number(resetTimeInSeconds) / 60)

    throw new Error(
      `${data?.error} Try again in ${minutesLeft} minutes or reset your password.`,
    )
  }

  // Only a rejected credential means attempts have been used up. Reading the
  // header on every failed status reported a 500 as "Incorrect email or
  // password. You have N attempts remaining."
  if (res.status === 401) {
    const remaining = res.headers.get("RateLimit-Remaining")

    throw new Error(
      remaining !== null
        ? `Incorrect email or password. You have ${remaining} attempts remaining.`
        : "Incorrect email or password.",
    )
  }

  if (!res.ok) {
    throw new Error("Failed to sign in, please try again later.")
  }

  if (data.token) {
    await signInProvider(data.token) // Set token and user
  }

  return {
    name: data.name,
    emailVerified: data.emailVerified,
  } // Optionally return name or user data
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
  const data = await apiRequest<{ token?: string; name: string }>(
    "/api/auth/checkVerificationCode",
    {
      method: "POST",
      body: { verificationCode, email },
      fallback: "Network error occurred.",
    },
  )

  if (!data.token) {
    throw new Error("Verification succeeded but no session token was returned.")
  }

  await signInProvider(data.token)
  return data.name
}

export async function getUserLoyaltyPoints(): Promise<number> {
  const data = await apiRequest<{ points: number }>(
    "/api/auth/getUserLoyaltyPoints",
    {
      authMessage: UNAUTHENTICATED,
      statusMessages: { 401: UNAUTHENTICATED },
    },
  )
  return data.points
}

export async function getAvailableCustomisations(
  dessertId: string,
): Promise<Customisation[]> {
  const data = await apiRequest<{ customisations: Customisation[] }>(
    `/api/getAvailableCustomisations/${dessertId}`,
    {
      errorMessage: "Failed to retrieve customisations, please try again later",
    },
  )
  return data.customisations
}

export async function getUserProfile(): Promise<UserDetails> {
  const data = await apiRequest<{ user: UserDetails }>("/api/auth/getUser", {
    authMessage: UNAUTHENTICATED,
    statusMessages: { 404: DETAILS_NOT_FOUND },
    fallback: SERVER_ERROR,
  })
  return data.user
}

export async function updateUserProfile(formData: AccountData) {
  const data = await apiRequest<{ user: UserDetails }>(
    "/api/auth/updateUser",
    {
      method: "PATCH",
      body: formData,
      authMessage: UNAUTHENTICATED,
      statusMessages: { 404: DETAILS_NOT_FOUND },
      fallback: SERVER_ERROR,
    },
  )
  return data.user
}

export async function updateAnonymousStatus(value: boolean): Promise<boolean> {
  const data = await apiRequest<{ value: boolean }>(
    "/api/auth/updateAnonymousStatus",
    {
      method: "PATCH",
      body: { value },
      authMessage: UNAUTHENTICATED,
      fallback: SERVER_ERROR,
    },
  )
  return data.value
}

export async function getUserOrders(status: OrderStatus): Promise<Order[]> {
  const data = await apiRequest<{ orders: Order[] }>("/api/auth/getUserOrders", {
    method: "POST",
    body: { status },
    authMessage: "Please sign in to view your orders",
    statusMessages: { 404: DETAILS_NOT_FOUND },
    fallback: SERVER_ERROR,
  })
  return data.orders
}

export async function createOrder(
  paymentMethodId: string | null,
  pickupNow: boolean,
  pickUpTime: Date,
  eatIn: boolean,
  paymentIntentId: string | null,
  idempotencyKey: string,
) {
  // Kept on apiFetch: a failure here has to distinguish "the order may already
  // exist" from "it definitely does not", which no single message can carry.
  const { res, data } = await apiFetch("/api/auth/createOrder", {
    method: "POST",
    body: {
      paymentMethodId,
      pickupNow,
      pickUpTime,
      eatIn,
      paymentIntentId,
    },
    authMessage: UNAUTHENTICATED,
    idempotencyKey,
  })

  if (res.status === 401) {
    throw new Error("Please sign in to place an order")
  }

  // The same order is already being placed on the server. Not a failure, and
  // above all not a reason to send a paid customer back to pay again.
  if (res.status === 409 && data?.inProgress) {
    throw new Error(
      "Your order is already being placed. Check your orders in a moment.",
    )
  }

  if (res.status === 400) {
    throw new Error("Failed to create order, please try again later")
  }

  if (!res.ok) {
    if (data?.orderId) {
      throw new Error("Order may have been created, please check your orders")
    }
    // Stamped in store time: the customer screenshots this for staff in NZ.
    throw new Error(
      `${formatDayStamp(
        new Date(),
      )} Failed to send order to kitchen, please take a screenshot and contact support`,
    )
  }

  return data.order
}

export const sendOrderStatusNotification = async (
  orderId: string,
  orderNumber: string,
  newStatus: string,
) =>
  apiRequest("/api/notification/orderStatusChange", {
    method: "POST",
    body: { orderId, orderNumber, newStatus },
    authMessage: UNAUTHENTICATED,
    errorMessage: "Failed to send notification",
  })

export const checkOrderStatus = async (orderId: string) =>
  apiRequest<any>(`/api/auth/orderStatus/${orderId}`, {
    authMessage: "Please sign in to check order status",
    fallback: "Failed to check order status",
  })

export const getCartItems = async (): Promise<CartItem[]> => {
  const data = await apiRequest<{ cartItems: CartItem[] }>(
    "/api/cart/getCartItems",
    {
      authMessage: "Please sign in to see your cart",
      statusMessages: { 401: UNAUTHENTICATED },
    },
  )
  return data.cartItems
}

export const addItemToCart = async (item: AddCartItem): Promise<CartItem> => {
  const {
    dessert,
    quantity,
    itemPriceInCents,
    customisations,
    loyaltyPointsUsed,
    offerId,
  } = item

  const data = await apiRequest<{ cartItem: CartItem }>(
    "/api/cart/addItemToCart",
    {
      method: "POST",
      body: {
        dessertId: dessert.id,
        quantity,
        itemPriceInCents,
        customisations,
        loyaltyPointsUsed,
        offerId,
      },
      authMessage: "Please sign in to add item",
      statusMessages: { 401: "Please sign in to add items to cart" },
      fallback: "Failed to add item to cart",
    },
  )
  return data.cartItem
}

export const removeItemFromCart = async (itemId: string): Promise<string> => {
  const data = await apiRequest<{ id: string }>(
    `/api/cart/removeItemFromCart/${itemId}`,
    {
      method: "DELETE",
      authMessage: "Please sign in to remove item from cart",
      fallback: "Failed to remove item from cart",
    },
  )
  return data.id
}

export const updateCartItem = async (
  item: CartItem,
): Promise<{ cartItem: CartItem }> => {
  const {
    id,
    dessert,
    quantity,
    customisations,
    itemPriceInCents,
    loyaltyPointsUsed,
    offerId,
  } = item

  const data = await apiRequest<{ cartItem: CartItem }>(
    "/api/cart/updateCartItem",
    {
      method: "PATCH",
      body: {
        id,
        dessertId: dessert.id,
        quantity,
        customisations,
        itemPriceInCents,
        loyaltyPointsUsed,
        offerId,
      },
      authMessage: "Please sign in to update your cart",
      fallback: "Failed to update item in cart",
    },
  )
  return { cartItem: data.cartItem }
}

export const clearCart = async () =>
  apiRequest<any>("/api/cart/clearCart", {
    method: "DELETE",
    authMessage: UNAUTHENTICATED,
    fallback: "Failed to clear cart",
  })

export const updateCartItemQuantity = async (
  itemId: string,
  quantity: number,
): Promise<CartItem> => {
  const data = await apiRequest<{ cartItem: CartItem }>(
    "/api/cart/updateCartItemQuantity",
    {
      method: "PATCH",
      body: { id: itemId, quantity },
      authMessage: "Please sign in to update item quantity in cart",
      fallback: "Failed to update cart item",
    },
  )
  return data.cartItem
}

export const showOffers = async (): Promise<Offers> => {
  const data = await apiRequest<{ offers: Offers }>("/api/auth/showOffers", {
    authMessage: "Please sign in to see membership offers",
    statusMessages: { 401: UNAUTHENTICATED },
  })
  return data.offers
}

export const showOfferForClient = async (): Promise<offerForClient[]> => {
  const data = await apiRequest<{ offers: offerForClient[] }>(
    "/api/showOfferForClient",
  )
  return data.offers
}

export const getResetPasswordCode = async (email: string): Promise<boolean> => {
  if (!email) {
    throw new Error("Email is required")
  }
  const data = await apiRequest<{ success: boolean }>(
    "/api/getResetPasswordCode",
    { method: "POST", body: { email } },
  )
  return data.success
}

export const resendVerificationCode = async (
  email: string,
): Promise<boolean> => {
  if (!email) {
    throw new Error("Email is required")
  }
  const data = await apiRequest<{ success: boolean }>(
    "/api/auth/resendVerificationCode",
    { method: "POST", body: { email } },
  )
  return data.success
}

export const verifyResetPasswordCode = async (email: string, OTP: string) => {
  if (!email) {
    throw new Error("Email is required")
  }
  if (!OTP) {
    throw new Error("Verification code is required")
  }
  return apiRequest<any>("/api/verifyResetPasswordCode", {
    method: "POST",
    body: { email, verificationCode: OTP },
  })
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
  return apiRequest<any>("/api/resetPassword", {
    method: "POST",
    body: { email, newPassword, resetToken },
  })
}

export const getStoreHours = async (): Promise<StoreHours> =>
  // Normalised on the way in: the API keys these by lower-case day name, while
  // everything downstream looks them up by the capitalised name date-fns gives.
  normaliseStoreHours(
    await apiRequest<StoreHours>("/api/getStoreHours", {
      errorMessage: "Error: Could not get store hours",
    }),
  )

/**
 * One-off dates the store is shut, on top of its weekly hours. The admin app
 * writes these as midnight on the chosen day, so the instant is only meaningful
 * once resolved back to a New Zealand calendar day — see `toDaysOff`.
 */
export const getDaysOff = async (): Promise<Date[]> => {
  const { dates } = await apiRequest<{ dates: string[] }>("/api/getDaysOff", {
    errorMessage: "Error: Could not get the store's days off",
  })

  return dates.map((date) => new Date(date))
}

export const getStoreInfo = async (): Promise<StoreInfo> =>
  apiRequest<StoreInfo>("/api/getStoreInfo", {
    errorMessage: "Error: Could not get store information",
  })

export const getRestaurantStatus = async (): Promise<RestaurantStatus> => {
  const data = await apiRequest<{ restaurantStatus: RestaurantStatus }>(
    "/api/restaurantStatus",
    { fallback: "Could not get restaurant status" },
  )
  return data.restaurantStatus
}

export const getLoyaltyRates = async (): Promise<LoyaltyRates> =>
  apiRequest<LoyaltyRates>("/api/getLoyaltyRates", {
    errorMessage: "Error: Could not get loyalty rates",
  })

export const getLeaderboardDetails = async (): Promise<LeaderBoardDetails> =>
  apiRequest<LeaderBoardDetails>("/api/getLeaderboardDetails")

export const getAnnouncements = async (): Promise<Announcements> =>
  apiRequest<Announcements>("/api/getAnnouncements")

export const getHomepageCards = async (): Promise<HomePageContent[]> =>
  apiRequest<HomePageContent[]>("/api/getHomepageCards")

export const getPrivacyPolicy = async (): Promise<PrivacyPolicy> =>
  apiRequest<PrivacyPolicy>("/api/getPrivacyPolicy")

export const getTermAndConditions = async (): Promise<TermAndConditions> =>
  apiRequest<TermAndConditions>("/api/getTermAndConditions")

export const getEstimatedPickUpTime = async (
  numOfItems: number,
): Promise<Date> => {
  if (numOfItems === 0) {
    return new Date()
  }

  const data = await apiRequest<{ estimatedTime: string }>(
    "/api/getEstimatedPickUpTime",
    { method: "POST", body: { numOfItems } },
  )
  return new Date(data.estimatedTime)
}

export const getLeaderBoard = async (): Promise<{
  leaderboard: LeaderBoard
  userRank: UserLeaderBoardRank
}> =>
  apiRequest("/api/auth/getLeaderBoard", {
    authMessage: "Please sign in to view the leaderboard",
  })
