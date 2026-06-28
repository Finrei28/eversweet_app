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
  isPromotionItem: boolean
  promotionType: string | null
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
}

// A single redemption record
export type Offer = {
  id: string
  name: string
  description: string | null
  image: string | null
  dessertId: string | null
  categoryId: string | null
  itemPriceInCents: number | null
  discountAmount: number | null
  limit: number
  dessert: Dessert | null
  category: DessertCategory | null
  requirements: OfferRequirement[]
  redemptions: {
    id: string
    membershipId: string
    offerId: string
    redeemedAt: Date | null
    used: number
    unlockedAt: Date
    renewsAt: Date | null
    status: "REDEEMED" | "AVAILABLE" | "EXPIRED"
  }[]
}

export type offerForClient = {
  name: string
  id: string
  image: string | null
  description: string | null
  dessertId: string | null
  categoryId: string | null
  itemPriceInCents: number | null
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

export type Promotion = {
  id: string
  title: string
  text1: string
  text2?: string
  category: string
  imagePath: string
}

export type Promotions = Promotion[]

export type Announcement = {
  title: string
  text1: string
  text2?: string
  updatedAt: string
}

export type Announcements = Announcement[]

export type HomePageContent = {
  title: string
  image: string
  category: string
}

export type SetUpIntent = {
  setupIntent: string | null
  ephemeralKey: string | undefined
  customer: string | undefined
  setupIntentId: string
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
