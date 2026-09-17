import { Stripe } from "stripe"

/**
 * A user's name, email and phone as their Stripe customer should carry them.
 *
 * The Stripe Dashboard shows who paid from these top-level fields. Customers used to be
 * created with the name and email in metadata only, which the Dashboard does not show, so
 * every app payment appeared there with no one against it. The Dashboard reads a payment's
 * customer as it is now, so filling a customer in labels its past payments too.
 */
export type CustomerDetails = {
  email: string
  name?: string
  phone?: string
}

export const customerDetailsOf = (user: {
  email: string
  firstName: string | null
  lastName: string | null
  phone: string | null
}): CustomerDetails => {
  // Joined from whichever parts exist: a template string wrote "null null" for an account
  // with no name on it.
  const name = [user.firstName, user.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ")
  const phone = user.phone?.trim()

  return {
    email: user.email,
    ...(name ? { name } : {}),
    ...(phone ? { phone } : {}),
  }
}

/**
 * The details a customer is missing or holds differently from the user row, or null when
 * it is up to date. A field the row has no value for is left as Stripe has it rather than
 * blanked.
 */
export const staleCustomerDetails = (
  customer: Pick<Stripe.Customer, "email" | "name" | "phone">,
  details: CustomerDetails,
): Partial<CustomerDetails> | null => {
  const stale: Partial<CustomerDetails> = {}

  if (customer.email !== details.email) stale.email = details.email
  if (details.name && customer.name !== details.name) stale.name = details.name
  if (details.phone && customer.phone !== details.phone) stale.phone = details.phone

  return Object.keys(stale).length > 0 ? stale : null
}

/**
 * What of a failed Stripe call is safe to log. A refused update's message can quote the
 * email or phone it refused, and customer details have no business in the server logs.
 */
export const describeStripeFailure = (error: unknown) =>
  error instanceof Stripe.errors.StripeError
    ? { type: error.type, code: error.code, param: error.param }
    : error instanceof Error
      ? error.name
      : "unknown error"
