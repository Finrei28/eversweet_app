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
      customisation: {
        id: string
        name: string
        chineseName: string
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

export type CartItemCustomisation = {
  quantity: number
  name: string
  id: string
  chineseName: string
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
