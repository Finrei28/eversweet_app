export type createAccountData = {
  firstName: string
  lastName: string
  email: string
  password: string
}

export type AccountData = {
  firstName: string
  lastName: string
  email: string
  phone: string
}

export type Customisation = {
  id: string
  chineseName: string
  name: string
  priceInCents: number
}

export type Customisations = {
  id: string
  chineseName: string
  name: string
  priceInCents: number
  discountedAmountInCents: number
  quantity: number
}[]

export type Ingredients = {
  name: string
  id: string
  priceInCents: number
  chineseName: string
  isAvailableForPurchase: boolean
}[]

export type Dessert = {
  id: string
  name: string
  chineseName: string
  description: string | null
  priceInCents: number
  priceInLoyaltyPoints: number
  imagePath: string
  ingredients: Ingredients
  promo: {
    type: "PERCENTAGE" | "FIXED_AMOUNT"
    value: number
    name: string
    id: string
    isActive: boolean
    startsAt: Date | null
    endsAt: Date | null
  } | null
}

export type DessertCategory = {
  id: string
  name: string
  chineseName: string
  desserts: Dessert[]
}

export type Menu = DessertCategory[]

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
  dineIn: boolean
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

export type CartItem = {
  id: string
  customisations: Customisations
  dessert: Dessert
  itemPriceInCents: number
  quantity: number
  loyaltyPointsUsed: number | null
  offerId: string | null
  discountedAmountInCents: number
}

export type AddCartItem = {
  customisations: Customisations
  dessert: Dessert
  itemPriceInCents: number
  quantity: number
  loyaltyPointsUsed: number | null
  offerId: string | null
}

export type MembershipDetails = {
  id: string
  price: number | null
  stripePriceId: string
  membershipBenefits: string[]
}

export type UsersMembership = {
  id: string
  createdAt: Date
  startDate: Date
  endDate: Date
  paymentStatus: "PENDING" | "SUCCESS" | "FAILED"
  stripeSubscriptionId: string | null
  planId: string
  isActive: boolean
  totalMonths: number
  cancel: boolean
  plan: {
    id: string
    name: string
    stripePriceId: string
    membershipDiscount: number
    maxDiscount: number
  }
}

export type MembershipStatus = {
  paymentStatus: "PENDING" | "SUCCESS" | "FAILED"
  isActive: boolean
  paymentFailureCode: string | null
  paymentFailureMessage: string | null
}

export type OfferRequirement = {
  id: string
  offerId: string
  dessertId: string | null
  categoryId: string | null
  quantity: number
  /**
   * Exactly one of these is set in practice, though nothing in the schema enforces it.
   * They exist so the card can name what unlocks the offer instead of showing a greyed
   * button with no explanation — see `describeRequirements`.
   */
  dessert: { name: string } | null
  category: { name: string } | null
}

/** Who an offer is for. Mirrors the OfferAudience enum in the Prisma schema. */
export type OfferAudience = "MEMBERS" | "EVERYONE" | "NEW_USERS"

/** Whether the signed-in viewer qualifies for each gated audience. */
export type OfferViewer = {
  isActiveMember: boolean
  isNewCustomer: boolean
}

// A single redemption record
export type Offer = {
  id: string
  name: string
  description: string | null
  image: string | null
  audience: OfferAudience
  dessertId: string | null
  categoryId: string | null
  itemPriceInCents: number | null
  /**
   * Whole percent off, 0-100. Ignored entirely when `itemPriceInCents` is set — that
   * wins. Was a Decimal fraction (0.2 meaning 20%) until the 2026-09-12 migration;
   * price it with `offerUnitPriceInCents` rather than by hand.
   */
  discountAmount: number | null
  limit: number
  dessert: Dessert | null
  category: DessertCategory | null
  requirements: OfferRequirement[]
  redemptions: {
    id: string
    userId: string
    offerId: string
    redeemedAt: Date | null
    used: number
    unlockedAt: Date
    status: "REDEEMED" | "AVAILABLE" | "EXPIRED"
  }[]
}

export type offerForClient = {
  name: string
  id: string
  image: string | null
  description: string | null
  audience: OfferAudience
  dessertId: string | null
  categoryId: string | null
  itemPriceInCents: number | null
  /** Whole percent off, 0-100 — see the note on `Offer.discountAmount`. */
  discountAmount: number | null
  limit: number
  dessert: {
    imagePath: string
  } | null
  category: {
    desserts: {
      imagePath: string
    }[]
  } | null
}

// The offers array type
export type Offers = Offer[]

export type RestaurantStatus = {
  dineInAvailability: boolean
  unavailableUntil: Date | null
}

export type LoyaltyRates = {
  memberRate: number
  rate: number
  modifier: number
}

export type LeaderBoardDetails = {
  show: boolean
  description: string
  /** First place only. Kept for builds that predate the podium. */
  lastMonthsWinner: string | null
  /**
   * Last month's podium, already redacted per winner. Optional because a
   * server that predates it will not send it — and because the app must not
   * decide anonymity itself: only the server knows each winner's setting.
   */
  lastMonthsTopThree?: { place: number; name: string }[]
}

/**
 * A month the customer finished in the top three, and what they won for it.
 *
 * `reward` is null while staff have not yet decided on a prize — a real state,
 * and the one a winner is in until the shop gets round to it.
 */
export type Prize = {
  id: string
  place: number
  month: number
  year: number
  points: number
  reward: {
    title: string
    description: string | null
    expiresAt: string
    redeemedAt: string | null
    /**
     * Only present while the counter would actually honour it. The server
     * withholds it once the prize expires or is collected, so the app can
     * never show a code that is about to be refused in a queue.
     */
    code: string | null
  } | null
}

export type Prizes = Prize[]

export type Announcement = {
  title: string
  text1: string
  text2?: string
  updatedAt: string
}

export type Announcements = Announcement[]

export type SetUpIntent = {
  setupIntent: string | null
  ephemeralKey: string | undefined
  customer: string | undefined
  setupIntentId: string
}

export type SavedCard = {
  id: string
  isDefault?: boolean
  card: {
    brand: string
    last4: string
    exp_month: number
    exp_year: number
  }
}

export type PaymentStatusResult = {
  success: boolean
  pending: boolean
  orderId: string | null
}

export type PrivacyPolicy = {
  type: string
  title: string
  lastUpdated: string
  sections: (
    | {
        heading: string
        content: string
        list?: undefined
      }
    | {
        heading: string
        list: string[]
        content?: undefined
      }
  )[]
}

export type TermAndConditions = {
  type: string
  title: string
  lastUpdated: string
  sections: (
    | {
        heading: string
        content: string
        list?: undefined
      }
    | {
        heading: string
        list: string[]
        content?: undefined
      }
  )[]
}

export type StoreInfo = {
  name: string
  isOpen: boolean
  address: string
  city: string
  state: string
  postal: string
  phone: string
  email: string
  website: string
}

export type StoreHours = {
  [key: string]: [string, string] | null
}

export type LeaderBoard = {
  user: {
    id: string
    firstName: string | null
    lastName: string | null
    anonymousEnabled: boolean
  } | null
  pointsEarned: number
}[]

export type UserLeaderBoardRank = {
  position: number
  points: number
} | null

export type UserDetails = {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  phone: string | null
  anonymousEnabled: boolean
}
