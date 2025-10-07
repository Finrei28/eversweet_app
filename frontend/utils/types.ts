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
      customisation: {
        id: string
        name: string
        chineseName: string
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
  cancel: boolean
}

export type MembershipStatus = {
  paymentStatus: "PENDING" | "SUCCESS" | "FAILED"
  isActive: boolean
}

// A single redemption record
export type Offer = {
  id: string
  name: string
  dessertId: string | null
  categoryId: string | null
  itemPriceInCents: number | null
  discountAmount: number | null
  limit: number
  dessert: Dessert | null
  category: DessertCategory | null
  redemptions: {
    id: string
    membershipId: string
    offerId: string
    redeemedAt: Date
    used: number
  }[]
}

// The offers array type
export type Offers = Offer[]

export type restaurantStatus = {
  dineInAvailability: boolean | undefined
  unavailableUntil: Date | null | undefined
}

export type LoyaltyRates = {
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
}
