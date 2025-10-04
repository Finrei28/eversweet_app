import { z } from "zod"

export const customisationSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  chineseName: z.string(),
  quantity: z.number().int(),
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
  pickUpTime: z.date(),
  eatIn: z.boolean(),
})

export const cartItemSchema = dessertSchema.extend({
  id: z.string().min(1),
})

type CreateOrderInput = z.infer<typeof CreateOrderSchema>
