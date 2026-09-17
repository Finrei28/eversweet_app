import { Stripe } from "stripe"

/**
 * The one Stripe client. Order creation has to read and refund payments as well as the
 * Stripe controller, and a module of its own lets both share it without a controller
 * importing another controller.
 */
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

/** An id whether Stripe sent the bare id or the expanded object. */
export const idOf = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : (value?.id ?? null)
