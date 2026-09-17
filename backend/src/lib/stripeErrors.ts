import { Stripe } from "stripe"

/**
 * What a failed Stripe call is allowed to tell the customer.
 *
 * Only a card error's message is written for them — "Your card was declined.", "Your card
 * has insufficient funds." Every other Stripe message, and every database one, names
 * internals: object ids, parameter names, the shape of a query. A dozen handlers used to
 * send those straight back to whoever asked, so the fallback is what everything else gets.
 */
export const stripeErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Stripe.errors.StripeCardError && error.message
    ? error.message
    : fallback

/** Stripe's answer for an id it has never issued, or has since deleted. */
export const isResourceMissing = (error: unknown): boolean =>
  error instanceof Stripe.errors.StripeInvalidRequestError &&
  error.code === "resource_missing"

/**
 * A Stripe lookup that settles to null for an id Stripe does not know, rather than
 * throwing. Ownership checks answer "not found" for that case, and a thrown error would
 * have come back as a 500 instead.
 */
export const orNullIfMissing = async <T>(lookup: Promise<T>): Promise<T | null> => {
  try {
    return await lookup
  } catch (error) {
    if (isResourceMissing(error)) return null
    throw error
  }
}
