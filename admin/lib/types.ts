export type Order = {
  id: string
  tempOrderId: string
  priceInCents: number
  discountedAmountInCents: number
  GST: number
  createdAt: Date
  updatedAt: Date
  customerFirstName: string
  customerLastName: string
  customerEmail: string
  customerPhoneNumber: string | null
  completedAt: Date | null
  pickedUpAt: Date | null
  pickUpTime: Date
  dineIn: Boolean
  appUserId: string
  status: OrderStatus // Assuming $Enums.Status refers to an enum for order status
  desserts: {
    id: string
    orderId: string
    quantity: number
    priceInCents: number
    discountedAmountInCents: number
    offerId: string
    dessert: {
      id: string
      name: string
      chineseName: string
      imagePath: string
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

export type OrderStatus =
  | "PENDING"
  | "ACCEPTED"
  | "MAKING"
  | "READY"
  | "PICKED_UP"

export type Overview = {
  overview: []
  today: number
  week: number
  month: number
  todaySales: number
}

export type RestaurantStatus = {
  dineInAvailability: boolean | undefined
  unavailableUntil: Date | null | undefined
}

export type PrintJob = {
  id: string
  order: Order
  createdAt: string
  status: "pending"
}

export type QueuedPrintJob = {
  printJob: PrintJob
  resolve: (success: boolean) => void
  reject: (error: Error) => void
}

export type QueuedOrder = {
  id: string
  order: Order
  createdAt: string
  status: "pending"
}
