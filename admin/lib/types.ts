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

/** What the shop owes a winner, once staff have decided. */
export type WinnerReward = {
  id: string
  title: string
  description: string | null
  /** Already grouped for reading aloud, e.g. "7K4M-Q92X". */
  code: string
  expiresAt: string
  redeemedAt: string | null
  expired: boolean
}

/**
 * One place on a month's podium.
 *
 * Real names, unlike the customer-facing board: staff have to hand the prize to
 * a person, so anonymity is deliberately not applied here.
 */
export type MonthlyWinner = {
  id: string
  place: number
  month: number
  year: number
  points: number
  userId: string | null
  firstName: string | null
  lastName: string | null
  /** The customer closed their account, so the prize cannot be collected. */
  accountClosed: boolean
  /** Null until staff have said what the prize is. */
  reward: WinnerReward | null
}

export type MonthlyWinners = {
  month: number
  year: number
  winners: MonthlyWinner[]
}

/** Why a code was refused, in the three cases staff need told apart. */
export type PrizeRefusal = "NOT_FOUND" | "ALREADY_REDEEMED" | "EXPIRED"

export type PrizeCodeCheck = {
  valid: boolean
  reason: PrizeRefusal | null
  message: string | null
  winner: MonthlyWinner
}
