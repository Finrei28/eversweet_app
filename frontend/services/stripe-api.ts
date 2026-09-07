// Backend calls for Stripe operations.
//
// These all went through their own copy of fetch + token header + status
// handling, which meant they never reached the 401 handling in apiClient: a
// session that expired left the membership and card screens erroring instead of
// signing the customer out. Going through `apiRequest` gets that for free, and
// `authMessage` is what marks each of these as needing a token.
import {
  MembershipDetails,
  MembershipStatus,
  PaymentStatusResult,
  SavedCard,
  SetUpIntent,
  UsersMembership,
} from "@/utils/types"
import { apiFetch, apiRequest } from "./apiClient"
import { getErrorMessage } from "@/utils/getError"

const UNAUTHENTICATED = "Unauthenticated"
const NO_MEMBERSHIP = "No membership found"

/**
 * Fetches saved cards from the server
 * @returns Array of saved payment methods
 */
export const getSavedCards = async (): Promise<SavedCard[]> => {
  const data = await apiRequest<{ paymentMethods?: SavedCard[] }>(
    "/api/stripe/paymentMethods",
    {
      authMessage: UNAUTHENTICATED,
      fallback: "Failed to fetch payment methods",
    },
  )

  return data.paymentMethods ?? []
}

export const createSetupIntent = async (): Promise<SetUpIntent> =>
  apiRequest<SetUpIntent>("/api/stripe/createSetupIntent", {
    method: "POST",
    authMessage: UNAUTHENTICATED,
    fallback: "Failed to create setup intent",
  })

export const retryPayment = async () => {
  const data = await apiRequest<{ success: boolean }>(
    "/api/stripe/retryPayment",
    {
      method: "POST",
      authMessage: UNAUTHENTICATED,
      fallback: "Retry payment failed",
    },
  )

  return data.success
}

export const setCardForMembershipPayments = async (
  setupIntentId: string,
): Promise<void> => {
  await apiRequest("/api/stripe/setCardForMembershipPayments", {
    method: "POST",
    body: { setupIntentId },
    authMessage: UNAUTHENTICATED,
    fallback: "Failed to save card",
  })
}

/**
 * Saves a payment method to the customer's account
 * @param paymentMethodId The Stripe payment method ID to save
 */
export const saveCard = async (paymentMethodId: string): Promise<void> => {
  await apiRequest("/api/stripe/saveCard", {
    method: "POST",
    body: { paymentMethodId },
    authMessage: UNAUTHENTICATED,
    fallback: "Failed to save card",
  })
}

/**
 * Removes a payment method from the customer's account
 * @param paymentMethodId The Stripe payment method ID to remove
 */
export const removeCard = async (paymentMethodId: string): Promise<void> => {
  await apiRequest("/api/stripe/removeCard", {
    method: "DELETE",
    body: { paymentMethodId },
    authMessage: UNAUTHENTICATED,
    fallback: "Failed to remove card",
  })
}

/**
 * The server found an order for the same items placed moments ago and wants
 * the customer asked before it charges again. Carries the existing order so
 * the prompt can name it.
 */
export class DuplicateOrderError extends Error {
  constructor(
    readonly existingOrder: {
      id: string
      tempOrderId: string
      createdAt: string
    },
  ) {
    super("You placed an order for these same items a few minutes ago.")
    this.name = "DuplicateOrderError"
  }
}

export const createPaymentIntent = async (
  amount: number,
  currency = "nzd",
  paymentMethodId?: string,
  // Sent so the server can refuse a slot outside trading hours before the card
  // is charged. Order creation happens after the charge and cannot refund.
  pickUp?: {
    pickUpTime: Date
    eatIn: boolean
    /** Set once the customer has confirmed a flagged repeat is intentional. */
    confirmDuplicate?: boolean
  },
): Promise<{ clientSecret: string; paymentIntentId: string }> => {
  // Kept on apiFetch rather than apiRequest: a flagged repeat is a question
  // for the customer, not an error message, and it carries a body to read.
  const { res, data } = await apiFetch("/api/stripe/createPaymentIntent", {
    method: "POST",
    body: {
      // The server prices the charge from the cart itself and refuses a total
      // that disagrees with this one, so a stale cart is reported rather than
      // charged at a price the customer never saw.
      amount,
      currency,
      paymentMethodId,
      pickUpTime: pickUp?.pickUpTime.toISOString(),
      eatIn: pickUp?.eatIn,
      confirmDuplicate: pickUp?.confirmDuplicate,
    },
    authMessage: UNAUTHENTICATED,
  })

  if (res.status === 409 && data?.code === "POSSIBLE_DUPLICATE") {
    throw new DuplicateOrderError(data.existingOrder)
  }

  if (!res.ok) {
    throw new Error(
      getErrorMessage(data, "Failed to create payment intent"),
    )
  }

  return {
    clientSecret: data.clientSecret,
    paymentIntentId: data.paymentIntentId,
  }
}

/**
 * Check the status of a payment intent
 * @param paymentIntentId The ID of the payment intent to check
 * @returns Object with success, pending, or error status
 */
export const checkPaymentStatus = async (
  paymentIntentId: string,
): Promise<PaymentStatusResult> =>
  apiRequest<PaymentStatusResult>(
    `/api/stripe/checkPaymentStatus/${encodeURIComponent(paymentIntentId)}`,
    {
      authMessage: UNAUTHENTICATED,
      fallback: "Failed to check payment status",
    },
  )

export const getMembershipDetails = async (): Promise<MembershipDetails> =>
  apiRequest<MembershipDetails>("/api/stripe/getMembershipDetails", {
    authMessage: UNAUTHENTICATED,
    statusMessages: { 401: UNAUTHENTICATED },
  })

export const getUsersMembership = async (): Promise<UsersMembership | null> =>
  apiRequest<UsersMembership | null>("/api/stripe/getUsersMembership", {
    authMessage: UNAUTHENTICATED,
    statusMessages: { 401: UNAUTHENTICATED, 404: NO_MEMBERSHIP },
  })

export const createMembership = async (
  paymentMethodId: string,
  stripePriceId: string,
) => {
  const JOIN_SIGN_IN = "Please sign in to join our membership."

  return apiRequest("/api/stripe/createMembership", {
    method: "POST",
    body: { paymentMethodId, stripePriceId },
    authMessage: JOIN_SIGN_IN,
    statusMessages: { 401: JOIN_SIGN_IN },
  })
}

export const cancelMembership = async (): Promise<Date> => {
  const data = await apiRequest<{ endDate: Date }>(
    "/api/stripe/cancelMembership",
    {
      method: "POST",
      authMessage: UNAUTHENTICATED,
      statusMessages: { 401: UNAUTHENTICATED, 404: NO_MEMBERSHIP },
    },
  )

  return data.endDate
}

export const resumeMembership = async () => {
  const data = await apiRequest<{ success: boolean }>(
    "/api/stripe/resumeMembership",
    {
      method: "POST",
      authMessage: UNAUTHENTICATED,
      statusMessages: { 401: UNAUTHENTICATED, 404: NO_MEMBERSHIP },
    },
  )

  return data.success
}

export const pollMembershipStatus = async (): Promise<MembershipStatus> =>
  apiRequest<MembershipStatus>("/api/stripe/pollMembershipStatus", {
    authMessage: UNAUTHENTICATED,
    statusMessages: { 401: UNAUTHENTICATED, 404: NO_MEMBERSHIP },
  })

export const getCurrentSubscriptionPaymentMethodId =
  async (): Promise<string> => {
    const data = await apiRequest<{ paymentMethodId: string }>(
      "/api/stripe/getCurrentSubscriptionPaymentMethodId",
      {
        authMessage: UNAUTHENTICATED,
        statusMessages: {
          401: UNAUTHENTICATED,
          404: "No subscription payment method found",
        },
      },
    )

    return data.paymentMethodId
  }
