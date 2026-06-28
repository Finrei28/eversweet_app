// This file contains the API calls to your backend for Stripe operations
import {
  MembershipDetails,
  MembershipStatus,
  SetUpIntent,
  UsersMembership,
} from "@/utils/types"
import * as SecureStore from "expo-secure-store"
/**
 * Fetches saved cards from the server
 * @returns Array of saved payment methods
 */
const url = process.env.EXPO_PUBLIC_URL!

export const getSavedCards = async (): Promise<any[]> => {
  const token = await SecureStore.getItemAsync("token")
  if (!token) {
    throw new Error("Unauthenticated")
  }
  try {
    const response = await fetch(`${url}/api/stripe/paymentMethods`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    })
    const data = await response.json()
    if (!response.ok) {
      throw new Error("Failed to fetch payment methods: " + data.message)
    }

    return data.paymentMethods || []
  } catch (error) {
    console.error(
      "Error fetching saved cards:",
      error instanceof Error ? error.message : error,
    )
    throw new Error("Failed to fetch saved cards. Please try again.")
  }
}

export const createSetupIntent = async (): Promise<SetUpIntent> => {
  const token = await SecureStore.getItemAsync("token")
  if (!token) {
    throw new Error("Unauthenticated")
  }
  try {
    const response = await fetch(`${url}/api/stripe/createSetupIntent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    })
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.message || "Failed to create setup intent")
    }
    return data
  } catch (error) {
    console.error(
      "Error creating setup intent:",
      error instanceof Error ? error.message : error,
    )
    throw new Error("Failed to create setup intent. Please try again.")
  }
}

export const retryPayment = async () => {
  const token = await SecureStore.getItemAsync("token")
  if (!token) {
    throw new Error("Unauthenticated")
  }
  try {
    const response = await fetch(`${url}/api/stripe/retryPayment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    })
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.message || "Retry payment failed")
    }
    return data.success
  } catch (error) {
    console.error(
      "Error retrying payment:",
      error instanceof Error ? error.message : error,
    )
    throw new Error("Payment retry failed. Please try again.")
  }
}

export const setCardForMembershipPayments = async (
  setupIntentId: string,
): Promise<void> => {
  const token = await SecureStore.getItemAsync("token")
  if (!token) {
    throw new Error("Unauthenticated")
  }
  try {
    const response = await fetch(
      `${url}/api/stripe/setCardForMembershipPayments`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ setupIntentId }),
      },
    )

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.message || "Failed to save card")
    }
  } catch (error) {
    console.error(
      "Error saving card:",
      error instanceof Error ? error.message : error,
    )
    throw new Error("Failed to save card. Please try again.")
  }
}

/**
 * Saves a payment method to the customer's account
 * @param paymentMethodId The Stripe payment method ID to save
 */
export const saveCard = async (paymentMethodId: string): Promise<void> => {
  const token = await SecureStore.getItemAsync("token")
  if (!token) {
    throw new Error("Unauthenticated")
  }
  try {
    const response = await fetch(`${url}/api/stripe/saveCard`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ paymentMethodId }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.message || "Failed to save card")
    }
  } catch (error) {
    console.error(
      "Error saving card:",
      error instanceof Error ? error.message : error,
    )
    throw new Error("Failed to save card. Please try again.")
  }
}

/**
 * Removes a payment method from the customer's account
 * @param paymentMethodId The Stripe payment method ID to remove
 */
export const removeCard = async (paymentMethodId: string): Promise<void> => {
  const token = await SecureStore.getItemAsync("token")
  if (!token) {
    throw new Error("Unauthenticated")
  }
  try {
    const response = await fetch(`${url}/api/stripe/removeCard`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ paymentMethodId }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.message || "Failed to remove card")
    }
  } catch (error) {
    console.error(
      "Error removing card:",
      error instanceof Error ? error.message : error,
    )
    throw new Error("Failed to remove card. Please try again.")
  }
}

export const createPaymentIntent = async (
  amount: number,
  currency = "nzd",
  paymentMethodId?: string,
): Promise<{ clientSecret: string; paymentIntentId: string }> => {
  const token = await SecureStore.getItemAsync("token")
  if (!token) {
    throw new Error("Unauthenticated")
  }
  try {
    const response = await fetch(`${url}/api/stripe/createPaymentIntent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        amount,
        currency,
        paymentMethodId,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.message || "Failed to create payment intent")
    }

    const data = await response.json()
    return {
      clientSecret: data.clientSecret,
      paymentIntentId: data.paymentIntentId,
    }
  } catch (error) {
    console.error(
      "Error creating payment intent:",
      error instanceof Error ? error.message : error,
    )
    throw new Error("Failed to create payment intent. Please try again.")
  }
}

/**
 * Check the status of a payment intent
 * @param paymentIntentId The ID of the payment intent to check
 * @returns Object with success, pending, or error status
 */
export const checkPaymentStatus = async (paymentIntentId: string) => {
  const token = await SecureStore.getItemAsync("token")
  if (!token) {
    throw new Error("Unauthenticated")
  }
  try {
    const response = await fetch(
      `${url}/api/stripe/checkPaymentStatus/${paymentIntentId}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      },
    )

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.message || "Failed to check payment status")
    }

    const data = await response.json()
    return data
  } catch (error) {
    console.error(
      "Error checking payment status:",
      error instanceof Error ? error.message : error,
    )
    throw new Error("Failed to check payment status. Please try again.")
  }
}

export const getMembershipDetails = async (): Promise<MembershipDetails> => {
  const token = await SecureStore.getItemAsync("token")
  if (!token) {
    throw new Error("Unauthenticated")
  }
  try {
    const res = await fetch(`${url}/api/stripe/getMembershipDetails`, {
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
    return data
  } catch (error: any) {
    console.error(
      "Error fetching membership details:",
      error instanceof Error ? error.message : error,
    )
    throw new Error(error?.message || "Something went wrong.")
  }
}

export const getUsersMembership = async (): Promise<UsersMembership | null> => {
  const token = await SecureStore.getItemAsync("token")

  if (!token) {
    throw new Error("Unauthenticated")
  }

  try {
    const res = await fetch(`${url}/api/stripe/getUsersMembership`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    })

    const data = await res.json()
    if (res.status === 404) {
      throw new Error("No membership found")
    }
    if (res.status === 401) {
      throw new Error("Unauthenticated")
    }
    if (!res.ok) {
      throw new Error(`Error: ${data.message}`)
    }

    return data
  } catch (error: any) {
    console.error(
      "Error fetching membership details:",
      error instanceof Error ? error.message : error,
    )
    throw new Error(error?.message || "Something went wrong.")
  }
}

export const createMembership = async (
  paymentMethodId: string,
  stripePriceId: string,
) => {
  const token = await SecureStore.getItemAsync("token")
  if (!token) {
    throw new Error("Please sign in to join our membership.")
  }
  try {
    const res = await fetch(`${url}/api/stripe/createMembership`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ paymentMethodId, stripePriceId }),
    })

    const data = await res.json()

    if (res.status === 401) {
      throw new Error("Please sign in to join our membership.")
    }
    if (!res.ok) {
      throw new Error(`Error: ${data.message}`)
    }

    return data
  } catch (error: any) {
    console.error(
      "Error creating membership:",
      error instanceof Error ? error.message : error,
    )
    throw new Error(error?.message || "Something went wrong.")
  }
}

export const cancelMembership = async (): Promise<Date> => {
  const token = await SecureStore.getItemAsync("token")
  if (!token) {
    throw new Error("Unauthenticated")
  }
  try {
    const res = await fetch(`${url}/api/stripe/cancelMembership`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    })

    const data = await res.json()
    if (res.status === 404) {
      throw new Error("No membership found")
    }
    if (res.status === 401) {
      throw new Error("Unauthenticated")
    }
    if (!res.ok) {
      throw new Error(`Error: ${data.message}`)
    }

    return data.endDate
  } catch (error: any) {
    console.error(
      "Error canceling membership:",
      error instanceof Error ? error.message : error,
    )
    throw new Error(error?.message || "Something went wrong.")
  }
}

export const resumeMembership = async () => {
  const token = await SecureStore.getItemAsync("token")
  if (!token) {
    throw new Error("Unauthenticated")
  }
  try {
    const res = await fetch(`${url}/api/stripe/resumeMembership`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    })

    const data = await res.json()
    if (res.status === 404) {
      throw new Error("No membership found")
    }
    if (res.status === 401) {
      throw new Error("Unauthenticated")
    }
    if (!res.ok) {
      throw new Error(`Error: ${data.message}`)
    }

    return data.success
  } catch (error: any) {
    console.error(
      "Error canceling membership:",
      error instanceof Error ? error.message : error,
    )
    throw new Error(error?.message || "Something went wrong.")
  }
}

export const pollMembershipStatus = async (): Promise<MembershipStatus> => {
  const token = await SecureStore.getItemAsync("token")
  if (!token) {
    throw new Error("Unauthenticated")
  }
  try {
    const res = await fetch(`${url}/api/stripe/pollMembershipStatus`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    })

    const data = await res.json()
    if (res.status === 404) {
      throw new Error("No membership found")
    }
    if (res.status === 401) {
      throw new Error("Unauthenticated")
    }
    if (!res.ok) {
      throw new Error(`Error: ${data.message}`)
    }

    return data
  } catch (error: any) {
    console.error(
      "Error fetching membership details:",
      error instanceof Error ? error.message : error,
    )
    throw new Error(error?.message || "Something went wrong.")
  }
}

export const getCurrentSubscriptionPaymentMethodId =
  async (): Promise<string> => {
    const token = await SecureStore.getItemAsync("token")
    if (!token) {
      throw new Error("Unauthenticated")
    }
    try {
      const res = await fetch(
        `${url}/api/stripe/getCurrentSubscriptionPaymentMethodId`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        },
      )

      const data = await res.json()
      if (res.status === 404) {
        throw new Error("No subscription payment method found")
      }
      if (res.status === 401) {
        throw new Error("Unauthenticated")
      }
      if (!res.ok) {
        throw new Error(`Error: ${data.message}`)
      }

      return data.paymentMethodId
    } catch (error: any) {
      console.error(
        "Error fetching current subscription payment method ID:",
        error instanceof Error ? error.message : error,
      )
      throw new Error(error?.message || "Something went wrong.")
    }
  }
