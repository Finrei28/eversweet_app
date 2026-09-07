export type Order = {
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
  dineIn: Boolean
  appUserId: string
  status: OrderStatus // Assuming $Enums.Status refers to an enum for order status
  /**
   * When the kitchen should start on it, as an ISO string. Sent by the server
   * on pending orders and order receipts, so the rule for when preparation
   * begins is not duplicated here. Absent on accepted and past orders, which
   * have no use for it.
   */
  dueAt?: string | null
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
  overview: {
    label: string
    value: number
  }[]
  today: number
  week: number
  month: number
  todaySales: number
}

/**
 * How long each size of order takes to make, in minutes.
 *
 * One row on the server, shared with the website. The kitchen is alerted
 * `prep + kitchenSlack` before pick-up; the customer is quoted at least
 * `quoteFloor`.
 */
export type PrepTimes = {
  singleItem: number
  upToThree: number
  upToSix: number
  moreThanSix: number
  kitchenSlack: number
  quoteFloor: number
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
  failCount?: number
}

export type QueuedOrder = {
  id: string
  order: Order
  createdAt: string
  status: "pending"
}

export type WinnerDetails = {
  userId: string | null
  firstName: string | null
  lastName: string | null
}
