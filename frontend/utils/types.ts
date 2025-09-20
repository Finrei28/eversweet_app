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

export type Dessert = {
  id: string
  name: string
  chineseName: string
  description: string | null
  priceInCents: number
  priceInLoyaltyPoints: number
  imagePath: string
  ingredients: string[]
}

export type DessertCategory = {
  id: string
  name: string
  chineseName: string
  desserts: Dessert[]
}

export type Menu = DessertCategory[]

export type OrderData = {
  items: {
    customisations: Customisations
    itemPriceInCents: number
    quantity: number
    loyaltyPointsUsed: number | null
    dessertId: string
  }[]
  paymentMethodId: string
  pickUpTime: Date
  GST: number
  totalPriceInCents: number
}

export type Order = {
  id: string
  tempOrderId: string
  priceInCents: number
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
  status: OrderStatus // Assuming $Enums.Status refers to an enum for order status
  desserts: {
    id: string
    dessertId: string
    orderId: string
    quantity: number
    dessert: {
      id: string
      name: string
      chineseName: string
      imagePath: string
      priceInCents: number
    }
    customisations: {
      id: string
      customisationId: string
      quantity: number
      customisation: {
        id: string
        name: string
        priceInCents: number
        isAvailableForPurchase: boolean
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
}

export type AddCartItem = {
  customisations: Customisations
  dessert: Dessert
  itemPriceInCents: number
  quantity: number
  loyaltyPointsUsed: number | null
}
