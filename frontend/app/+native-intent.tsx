import { handleURLCallback } from "@stripe/stripe-react-native"

/**
 * Stripe comes back into the app through a deep link once a bank's 3D Secure
 * check is done: `eversweet://safepay` (what the SDK builds from the
 * StripeProvider's `urlScheme`) or `eversweet://stripe-redirect` (the payment
 * sheet's `returnURL` in utils/stripeMethod.ts). Expo Router took each for a
 * route, found none, and replaced checkout, the card sheet or the membership
 * screen with "Unmatched Route" just as the payment was being confirmed.
 *
 * Those links are Stripe's alone: hand them to the SDK and don't navigate, so
 * the customer stays on the screen that is waiting for the result. Matched on
 * the host rather than the scheme, because a development build also answers to
 * its own `exp+...` scheme.
 */
const STRIPE_RETURN = /^[a-z][a-z0-9+.-]*:\/\/\/?(safepay|stripe-redirect)(?=[/?#]|$)/i

export async function redirectSystemPath({
  path,
  initial,
}: {
  path: string
  initial: boolean
}): Promise<string> {
  if (!STRIPE_RETURN.test(path)) return path

  try {
    await handleURLCallback(path)
  } catch (error) {
    console.error("Stripe could not handle its return link:", error)
  }

  // A falsy path is dropped by the router's listener, leaving the current
  // screen in place. A cold start has no screen to stay on - the app was
  // closed mid-check - so that one opens the home tab.
  return initial ? "/" : ""
}
