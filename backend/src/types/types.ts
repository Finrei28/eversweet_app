import { $Enums } from "@prisma/client"

export type FullOrderType = {
  id: string
  tempOrderId: string
  priceInCents: number
  discountedAmountInCents: number
  GST: number
  createdAt: Date
  customerFirstName: string
  customerLastName: string
  customerEmail: string
  customerPhoneNumber: string | null
  pickedUpAt: Date | null
  pickUpTime: Date
  status: StatusType // Assuming $Enums.Status refers to an enum for order status
  desserts: {
    id: string
    orderId: string
    quantity: number
    priceInCents: number
    discountedAmountInCents: number
    dessert: {
      id: string
      name: string
      chineseName: string
      imagePath: string
      categoryId: string
    }
    customisations: {
      id: string
      quantity: number
      discountedAmountInCents: number
      customisation: {
        id: string
        name: string
        chineseName: string
        priceInCents: number
      }
    }[]
  }[]
}

export type OrderType = {
  id: string
  tempOrderId: string
  priceInCents: number
  GST: number
  createdAt: Date
  customerFirstName: string
  customerLastName: string
  customerEmail: string
  customerPhoneNumber: string | null
  completedAt: Date | null
  pickedUpAt: Date | null
  pickUpTime: Date
  status: StatusType
  appUserId: string | null
  source: "WEBSITE" | "APP"
  paymentIntentId: string | null
  paymentMethodId: string | null
  notified: boolean
}

export type WebOrderType = {
  desserts: {
    dessert: {
      id: string
      quantity: number
    }
    priceInCents: number
    discountedAmountInCents: number
    promoId: string | null
    customisations: {
      id: string
      quantity: number
      name: string
      chineseName: string
    }[]
  }[]
  customerFirstName: string
  customerLastName: string
  customerEmail: string
  customerPhoneNumber: string | null
  totalPriceInCents: number
  pickUpTime: Date
}

export type Dessert = {
  promo: {
    name: string
    id: string
    isActive: boolean
    type: $Enums.PromoType
    value: number
    startsAt: Date | null
    endsAt: Date | null
  } | null
} & {
  name: string
  id: string
  createdAt: Date
  chineseName: string
  description: string | null
  priceInCents: number
  imagePath: string
  imagePublicId: string
  isAvailableForPurchase: boolean
  updatedAt: Date
  categoryId: string
  priceInLoyaltyPoints: number
  promoId: string | null
}

export type CartItemCustomisation = {
  quantity: number
  name: string
  id: string
  chineseName: string
  priceInCents: number
}

export type Membership =
  | ({
      plan: {
        name: string
        id: string
        membershipDiscount: number
        maxDiscount: number
        stripePriceId: string
      }
    } & {
      id: string
      createdAt: Date
      isActive: boolean
      updatedAt: Date
      userId: string
      stripeSubscriptionId: string | null
      planId: string
      startDate: Date
      endDate: Date
      cancel: boolean
      stripePaymentMethodId: string | null
      paymentStatus: $Enums.PaymentStatus
      paymentFailureCode: string | null
      paymentFailureMessage: string | null
      totalMonths: number
    })
  | null

export type CartItem = {
  dessertId: string
  itemPriceInCents: number
  quantity: number
  customisations: {
    name: string
    id: string
    quantity: number
    chineseName: string
    priceInCents: number
  }[]
  loyaltyPointsUsed?: number | null | undefined
  offerId?: string | null | undefined
}

export type StatusType =
  | "PENDING"
  | "ACCEPTED"
  | "MAKING"
  | "READY"
  | "PICKED_UP"

export enum Status {
  PENDING = "PENDING",
  ACCEPTED = "ACCEPTED",
  MAKING = "MAKING",
  READY = "READY",
  PICKED_UP = "PICKED_UP",
}
