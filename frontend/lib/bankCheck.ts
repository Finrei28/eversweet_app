/**
 * The part of a `confirmPayment` error this reads. Structural rather than the SDK's
 * own type so the rule can be tested without loading the native module.
 */
export type ConfirmPaymentFailure = {
  code?: string
  stripeErrorCode?: string | null
  declineCode?: string | null
  message?: string | null
}

export const BANK_CHECK_NOT_COMPLETED =
  "Your bank's check wasn't completed, so you haven't been charged. Please try again, or pay with another card."

export const PAYMENT_NOT_COMPLETED =
  "We couldn't complete the payment. Please try again, or pay with another card."

/**
 * What to tell a customer whose card payment `confirmPayment` refused.
 *
 * Only a message Stripe's API sent about the card is shown as it is: those come with a
 * `stripeErrorCode` or a `declineCode`, and are written for customers ("Your card has
 * insufficient funds."). Everything else is worded for developers and was reaching the
 * checkout toast word for word, in live mode as in test:
 * - closing the bank's check, or failing it, gives `payment_intent_authentication_failure`
 *   with "The provided PaymentMethod has failed authentication. You can provide
 *   payment_method_data or a new PaymentMethod...";
 * - a wrong code in the bank's check on Android gives the SDK's own "Failed with
 *   transaction_status: N" (the 3D Secure verdict, N for not authenticated) with no code
 *   at all;
 * - and the SDK has other failures of its own, also uncoded.
 *
 * The first two leave nothing held, so they can say so. An uncoded failure otherwise
 * could be anything, including a network error after the card was confirmed, so the
 * general message promises nothing about the charge.
 */
export function bankCheckMessage(error: ConfirmPaymentFailure): string {
  if (
    error.code === "Canceled" ||
    error.stripeErrorCode === "payment_intent_authentication_failure" ||
    /transaction_status/i.test(error.message ?? "")
  ) {
    return BANK_CHECK_NOT_COMPLETED
  }
  if ((error.stripeErrorCode || error.declineCode) && error.message) {
    return error.message
  }
  return PAYMENT_NOT_COMPLETED
}
