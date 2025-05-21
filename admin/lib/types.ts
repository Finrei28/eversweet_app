export type Order = {
  id: string
  tempOrderId: string
  priceInCents: number
  createdAt: Date
  customerFirstName: string
  customerLastName: string
  customerEmail: string
  customerPhoneNumber: string | null
  completedAt: Date | null
  pickedUpAt: Date | null
  pickUpTime: Date
  GST: number
  appUserId: string | null
  status: OrderStatus // Assuming $Enums.Status refers to an enum for order status
  notes: string
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
