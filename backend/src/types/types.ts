import { $Enums } from "@prisma/client"

export type FullOrderType = {
  id: string
  tempOrderId: string
  priceInCents: number
  GST: number
  createdAt: Date
  customerFirstName: string
  customerLastName: string
  customerEmail: string
  customerPhoneNumber: string | null
  pickedUpAt: Date | null
  pickUpTime: Date
  status: $Enums.Status // Assuming $Enums.Status refers to an enum for order status
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
      }
    }[]
  }[]
}
