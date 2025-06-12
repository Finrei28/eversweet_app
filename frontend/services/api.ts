import {
  createAccountData,
  Customisation,
  AccountData,
  OrderData,
  OrderStatus,
} from "@/utils/types"
import * as SecureStore from "expo-secure-store"
import { Menu, Order } from "@/utils/types"
import { format } from "date-fns"
import { getToken } from "./authToken"
import { useAuth } from "@/store/authProvider"

const url = process.env.EXPO_PUBLIC_URL!

export async function fetchCategoriesWithDesserts(): Promise<Menu> {
  const res = await fetch(`${url}/api/getMenu`)
  if (!res.ok) {
    throw new Error("Failed to fetch menu")
  }

  const data = await res.json()

  // Optionally filter if needed
  const filteredCategories = data.menu.filter(
    (category) => category.desserts.length > 0
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
}: {
  email: string
  verificationCode: string
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
    switch (res.status) {
      case 200:
        // ✅ Code is valid
        await SecureStore.setItemAsync("token", data.token)
        return data.name

      case 400:
        // ❌ User not found / expired / invalid format
        throw new Error(data.message || "Bad request")

      case 401:
        // ❌ Invalid OTP
        throw new Error(data.message || "Unauthorized")

      case 500:
        // ❌ Server error
        throw new Error("Something went wrong. Please try again later.")

      default:
        throw new Error("Unexpected error occurred.")
    }
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

export async function getAvailableCustomisations(): Promise<Customisation[]> {
  try {
    const res = await fetch(`${url}/api/getAvailableCustomisations`)

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
    const res = await fetch(`${url}/api/auth/getUser`, {
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
    throw new Error("Unauthenticated")
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
  orderData: OrderData,
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
        ...orderData,
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
    throw error
  }
}

export const checkOrderStatus = async (orderId: string) => {
  try {
    const token = await getToken()
    if (!token) {
      throw new Error("Not authenticated")
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
    throw error
  }
}
