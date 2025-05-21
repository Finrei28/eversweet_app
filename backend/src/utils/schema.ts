import { z } from "zod"

export const customisationSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  chineseName: z.string(),
  quantity: z.number().int(),
})

export const dessertSchema = z.object({
  itemPriceInCents: z.coerce.number().int().min(0),
  dessertId: z.string().min(1),
  customisations: z.array(customisationSchema).default([]),
  quantity: z.number().int().positive(),
  loyaltyPointsUsed: z.number().nullable().optional(),
})

export const CreateOrderSchema = z.object({
  items: z.array(dessertSchema),
  paymentMethodId: z.string().nullable().optional(),
  paymentIntentId: z.string().nullable().optional(),
  totalPriceInCents: z.coerce.number().int().min(0),
  GST: z.number(),
  pickUpTime: z.date(),
})

type CreateOrderInput = z.infer<typeof CreateOrderSchema>
