import { z } from "zod"

export const customisationSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  chineseName: z.string(),
  quantity: z.number().int(),
  priceInCents: z.coerce.number().min(0),
  discountedAmountInCents: z.coerce.number().min(0),
})

export const dessertSchema = z.object({
  itemPriceInCents: z.coerce.number().min(0),
  dessertId: z.string().min(1),
  customisations: z.array(customisationSchema).default([]),
  quantity: z.number().int().positive(),
  loyaltyPointsUsed: z.number().nullable().optional(),
  offerId: z.string().nullable().optional(),
})

export const CreateOrderSchema = z.object({
  paymentMethodId: z.string().nullable().optional(),
  paymentIntentId: z.string().nullable().optional(),
  pickupNow: z.boolean(),
  pickUpTime: z.date(),
  eatIn: z.boolean(),
})

export const cartItemSchema = dessertSchema.extend({
  id: z.string().min(1),
})

type CreateOrderInput = z.infer<typeof CreateOrderSchema>

/**
 * The longest each profile field may be, measured after trimming.
 *
 * There were no limits at all: sign-up and the account screen stored whatever arrived, up
 * to the 100kb JSON body limit. A name is printed on the kitchen's thermal receipt, shown
 * to every customer on the leaderboard, and copied into every order row that customer
 * places, so a megabyte-long one was a problem in all three places. Phone allows for the
 * E.164 form the app sends (16 characters) with room to spare; email is the SMTP limit.
 */
export const PROFILE_FIELD_LIMITS = {
  email: { label: "Email", max: 254 },
  firstName: { label: "First name", max: 50 },
  lastName: { label: "Last name", max: 50 },
  phone: { label: "Phone number", max: 20 },
} as const

export type ProfileField = keyof typeof PROFILE_FIELD_LIMITS

/**
 * The fields trimmed, or the first reason to refuse them. A value that is not a string is
 * refused too: sign-up called `.trim()` on whatever it was sent, so a number or an object
 * threw outside its try and came back as a 500.
 */
export const readProfileFields = <K extends ProfileField>(
  values: Record<K, unknown>,
): { ok: true; values: Record<K, string> } | { ok: false; message: string } => {
  const read = {} as Record<K, string>

  for (const field of Object.keys(values) as K[]) {
    const { label, max } = PROFILE_FIELD_LIMITS[field]
    const value = values[field]
    const trimmed = typeof value === "string" ? value.trim() : ""

    if (!trimmed) return { ok: false, message: `${label} is required` }
    if (trimmed.length > max) {
      return {
        ok: false,
        message: `${label} must be ${max} characters or fewer`,
      }
    }

    read[field] = trimmed
  }

  return { ok: true, values: read }
}
