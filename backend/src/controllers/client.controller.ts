import { Request, Response } from "express"
import { db } from "../lib/db"

export const getMenu = async (req: Request, res: Response) => {
  try {
    const menu = await db.category.findMany({
      include: {
        desserts: {
          where: { isAvailableForPurchase: true },
          orderBy: { priceInCents: "asc" },
          select: {
            id: true,
            name: true,
            chineseName: true,
            priceInCents: true,
            imagePath: true,
            ingredients: true,
            description: true,
          },
        },
      },
    })
    if (!menu) {
      res.status(404).json({ message: "No products found" })
      return
    }
    res.status(200).json({ menu })
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch menu" })
    return
  }
}

export const getAvailableCustomisations = async (
  req: Request,
  res: Response
) => {
  try {
    const customisations = await db.dessertCustomisation.findMany({
      where: { isAvailableForPurchase: true },
      orderBy: { priceInCents: "asc" },
      select: {
        id: true,
        chineseName: true,
        name: true,
        priceInCents: true,
      },
    })
    if (!customisations) {
      res.status(404).json({ message: "No customisations available" })
      return
    }
    res.status(200).json({ customisations })
  } catch (error) {
    res.status(500).json({ message: error })
  }
}
