import { Request, Response } from "express"
import { db } from "../lib/db"
import { cartItemSchema, dessertSchema } from "../utils/schema"

// function getNextMonday(fromDate = new Date()): Date {
//   const date = new Date(fromDate)
//   const day = date.getDay() // 0 = Sunday, 1 = Monday, ... 6 = Saturday
//   const daysUntilMonday = (8 - day) % 7 || 7 // ensures we always move forward
//   date.setDate(date.getDate() + daysUntilMonday)
//   date.setHours(0, 0, 0, 0) // optional: normalize to start of day
//   return date
// }

export const redeemOfferForMembership = async (
  membershipId: string,
  offerId: string
) => {
  const offer = await db.offer.findUnique({ where: { id: offerId } })
  if (!offer) throw new Error("Offer does not exist")
  const existing = await db.offerRedemption.findUnique({
    where: {
      offerId_membershipId: { offerId, membershipId },
    },
  })

  if (existing) {
    if (existing.used >= offer.limit) {
      throw new Error("Offer usage limit reached")
    }

    return await db.offerRedemption.update({
      where: { id: existing.id },
      data: { used: { increment: 1 }, redeemedAt: new Date() },
    })
  }

  // Create new redemption
  return await db.offerRedemption.create({
    data: {
      offerId,
      membershipId,
      used: 1,
      redeemedAt: new Date(),
    },
  })
}

export const addItemToCart = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId

    if (!userId) {
      res.status(401).json({ message: "Unauthorised" })
      return
    }

    const parsedBody = dessertSchema.safeParse(req.body)

    if (!parsedBody.success) {
      res.status(400).json({
        message: "Invalid request body",
        errors: parsedBody.error.errors,
      })
      return
    }

    const cartItem = parsedBody.data

    if (cartItem.offerId) {
      const membership = await db.membership.findUnique({ where: { userId } })
      if (!membership?.isActive) {
        res.status(403).json({
          message: "Join our membership to redeem this awesome offer!",
        })
        return
      }
      await redeemOfferForMembership(membership.id, cartItem.offerId)
    }

    // If user used loyalty points, deduct from their account
    if (cartItem.loyaltyPointsUsed) {
      const existing = await db.loyalty.findUnique({
        where: { userId },
        select: { points: true },
      })

      if (!existing) throw new Error("User loyalty record not found")
      if (existing.points < cartItem.loyaltyPointsUsed) {
        res.status(400).json({ message: "Insufficient loyalty points" })
        return
      }
      await db.loyalty.update({
        where: { userId },
        data: {
          points: {
            decrement: cartItem.loyaltyPointsUsed,
          },
        },
      })
    }

    let cart = await db.cart.findUnique({
      where: { userId },
      select: {
        cartItems: {
          include: {
            dessert: {
              include: { ingredients: { select: { ingredient: true } } },
            },
            customisations: { select: { customisation: true, quantity: true } },
          },
        },
      },
    })

    const cartItemData: any = {
      dessert: {
        connect: {
          id: cartItem.dessertId, // Ensure dessert exists before connecting
        },
      },
      quantity: cartItem.quantity,
      itemPriceInCents: cartItem.itemPriceInCents, // get price from order item
      loyaltyPointsUsed: cartItem.loyaltyPointsUsed ?? null,
      discountedAmountInCents: cartItem.discountedAmountInCents,
      customisations: {
        create: cartItem.customisations.map((cartItemCustomisation) => ({
          customisation: {
            connect: {
              id: cartItemCustomisation.id, // Ensure customisation exists before connecting
            },
          },
          quantity: cartItemCustomisation.quantity,
        })),
      },
    }

    if (cartItem.offerId) {
      cartItemData.offer = { connect: { id: cartItem.offerId } }
    }

    if (!cart) {
      // create a new cart if no cart

      cart = await db.cart.create({
        data: {
          user: { connect: { id: userId } },
          expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000), // 12 hours from now
          totalLoyaltyPointsUsed: cartItem.loyaltyPointsUsed ?? 0,
          totalPriceInCents: cartItem.itemPriceInCents,
          cartItems: {
            create: cartItemData,
          },
        },
        select: {
          cartItems: {
            include: {
              dessert: {
                include: { ingredients: { select: { ingredient: true } } },
              },
              customisations: {
                select: { customisation: true, quantity: true },
              },
            },
          },
        },
      })
    } else {
      // create new cart item

      cart = await db.cart.update({
        where: { userId },
        data: {
          expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000), // extend expiry
          totalLoyaltyPointsUsed: {
            increment: cartItem.loyaltyPointsUsed ?? 0,
          },
          totalPriceInCents: { increment: cartItem.itemPriceInCents },
          cartItems: {
            create: cartItemData,
          },
        },
        select: {
          cartItems: {
            include: {
              dessert: {
                include: { ingredients: { select: { ingredient: true } } },
              },
              customisations: {
                select: { customisation: true, quantity: true },
              },
            },
          },
        },
      })
    }

    const cartItems = cart.cartItems.map((item) => ({
      ...item,
      dessert: {
        ...item.dessert,
        ingredients: item.dessert.ingredients.map((i) => i.ingredient),
      },
      customisations: item.customisations.map((c) => ({
        ...c.customisation,
        quantity: c.quantity,
      })),
    }))

    res.status(201).json({ success: true, cartItems })
    return
  } catch (error) {
    console.error(error)
    res.status(500).json({ success: false, message: "Internal server error" })
    return
  }
}

export const getCartItems = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId
    if (!userId) {
      res.status(401).json({ message: "Unauthorised" })
      return
    }

    const cart = await db.cart.findUnique({
      where: { userId },
      select: {
        id: true,
        expiresAt: true,
        cartItems: {
          select: { id: true, offerId: true, loyaltyPointsUsed: true },
        },
      },
    })

    const membership = await db.membership.findUnique({ where: { userId } })

    if (cart && cart.expiresAt && cart.expiresAt < new Date()) {
      const totalPointsToRefund = cart.cartItems.reduce((sum, item) => {
        return sum + (item.loyaltyPointsUsed ?? 0)
      }, 0)

      if (totalPointsToRefund > 0) {
        await db.loyalty.update({
          where: { userId },
          data: { points: { increment: totalPointsToRefund } },
        })
      }

      const cartItemsWithOffer = cart.cartItems.filter((item) => item.offerId)

      for (const item of cartItemsWithOffer) {
        if (item.offerId) {
          if (!membership) {
            break
          }
          await db.offerRedemption.updateMany({
            where: {
              offerId: item.offerId,
              membershipId: membership.id,
            },
            data: {
              used: { decrement: 1 },
            },
          })
        }
      }
      await db.cart.delete({ where: { id: cart.id } })
      res.status(200).json({ success: true, message: "Cart expired" })
      return
    }

    let warning: string | null = null

    // if user is not a member, remove all offers from cart and restore redemptions
    if (!membership?.isActive && cart) {
      const cartItemsWithOffer = cart.cartItems.filter((item) => item.offerId)
      if (cartItemsWithOffer.length > 0) {
        for (const item of cartItemsWithOffer) {
          if (item.offerId) {
            if (!membership) {
              break
            }
            await db.offerRedemption.updateMany({
              where: {
                offerId: item.offerId,
                membershipId: membership.id,
              },
              data: {
                used: { decrement: 1 },
              },
            })
          }
        }
        const deletedItems = await db.cartItem.deleteMany({
          where: {
            cart: { userId },
            offerId: { not: null },
          },
        })

        if (deletedItems.count > 0) {
          warning =
            "One or more items in your cart required an active membership. These items have been removed from your cart."
        }
      }
    }

    const rawCartItems = await db.cartItem.findMany({
      where: { cart: { userId } },
      include: {
        dessert: {
          select: {
            id: true,
            name: true,
            chineseName: true,
            description: true,
            priceInCents: true,
            priceInLoyaltyPoints: true,
            imagePath: true,
            ingredients: { select: { ingredient: true } },
          },
        },
        customisations: { select: { customisation: true, quantity: true } },
      },
    })

    const cartItems = rawCartItems.map((item) => ({
      ...item,
      dessert: {
        ...item.dessert,
        ingredients: item.dessert.ingredients.map((i) => i.ingredient),
      },
      customisations: item.customisations.map((c) => ({
        ...c.customisation,
        quantity: c.quantity,
      })),
    }))
    res.status(200).json({
      cartItems,
      warning,
    })
    return
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: "Internal server error" })
    return
  }
}

export const clearCart = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId
    if (!userId) {
      res.status(401).json({ message: "Unauthorised" })
      return
    }
    const cart = await db.cart.findUnique({
      where: { userId },
      include: { cartItems: true },
    })

    if (!cart) {
      res.status(404).json({ message: "No cart found" })
      return
    }
    const totalPointsToRefund = cart.cartItems.reduce((sum, item) => {
      return sum + (item.loyaltyPointsUsed ?? 0)
    }, 0)

    if (totalPointsToRefund > 0) {
      await db.loyalty.update({
        where: { userId },
        data: { points: { increment: totalPointsToRefund } },
      })
    }

    const cartItemsWithOffer = cart.cartItems.filter((item) => item.offerId)

    for (const item of cartItemsWithOffer) {
      if (item.offerId) {
        const membership = await db.membership.findUnique({ where: { userId } })
        if (!membership) {
          break
        }
        await db.offerRedemption.updateMany({
          where: {
            offerId: item.offerId,
            membershipId: membership.id,
          },
          data: {
            used: { decrement: 1 },
          },
        })
      }
    }

    await db.cart.delete({ where: { userId } })
    res.status(200).json({ success: true, message: "Cart cleared" })
    return
  } catch (error) {
    console.error(error)
    res.status(500).json({ success: false, message: "Internal server error" })
    return
  }
}

export const removeItemFromCart = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId
    if (!userId) {
      res.status(401).json({ message: "Unauthorised" })
      return
    }
    const { id } = req.params
    if (!id) {
      res.status(400).json({ message: "cartItemId is required" })
      return
    }

    const cartItem = await db.cartItem.findUnique({
      where: { id },
      select: {
        loyaltyPointsUsed: true,
        itemPriceInCents: true,
        offerId: true,
      },
    })

    if (!cartItem) {
      res.status(404).json({ message: "cart item not found" })
      return
    }
    const membership = await db.membership.findUnique({ where: { userId } })

    if (cartItem?.offerId) {
      if (!membership) {
        res.status(403).json({ message: "No membership record found" })
        return
      }
      await db.offerRedemption.updateMany({
        where: {
          offerId: cartItem.offerId,
          membershipId: membership.id,
        },
        data: {
          used: { decrement: 1 },
        },
      })
    }
    const updatedCart = await db.cart.update({
      where: { userId },
      data: {
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000), // extend expiry
        totalLoyaltyPointsUsed: {
          decrement: cartItem?.loyaltyPointsUsed ?? 0,
        },
        totalPriceInCents: { decrement: cartItem?.itemPriceInCents ?? 0 },
        cartItems: {
          delete: { id },
        },
      },
      include: {
        cartItems: {
          include: {
            dessert: {
              select: {
                id: true,
                name: true,
                chineseName: true,
                description: true,
                priceInCents: true,
                priceInLoyaltyPoints: true,
                imagePath: true,
                ingredients: { include: { ingredient: true } },
              },
            },
            customisations: { include: { customisation: true } },
          },
        },
      },
    })
    // restore loyalty points if any were used
    if (cartItem && cartItem.loyaltyPointsUsed) {
      await db.loyalty.update({
        where: { userId },
        data: {
          points: {
            increment: cartItem.loyaltyPointsUsed,
          },
        },
      })
    }
    // delete cart if empty
    if (updatedCart && updatedCart.cartItems.length === 0) {
      await db.cart.delete({ where: { id: updatedCart.id } })
    }
    const cartItems = updatedCart.cartItems.map((item) => ({
      ...item,
      dessert: {
        ...item.dessert,
        ingredients: item.dessert.ingredients.map((i) => i.ingredient),
      },
      customisations: item.customisations.map((c) => ({
        ...c.customisation,
        quantity: c.quantity,
      })),
    }))
    res.status(200).json({ success: true, cartItems })
    return
  } catch (error) {
    console.error(error)
    res.status(500).json({ success: false, message: "Internal server error" })
    return
  }
}

export const updateCartItem = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId
    if (!userId) {
      res.status(401).json({ message: "Unauthorised" })
      return
    }
    const parsedBody = cartItemSchema.safeParse(req.body)

    if (!parsedBody.success) {
      res.status(400).json({
        message: "Invalid request body",
        errors: parsedBody.error.errors,
      })
      return
    }

    const cartItem = parsedBody.data

    const existingCartItem = await db.cartItem.findUnique({
      where: { id: cartItem.id },
      select: {
        itemPriceInCents: true,
        loyaltyPointsUsed: true,
        quantity: true,
      },
    })

    if (!existingCartItem) {
      res.status(404).json({ message: "Cart item not found" })
      return
    }

    const priceDifference =
      (cartItem.itemPriceInCents - existingCartItem.itemPriceInCents) *
      existingCartItem.quantity
    const loyaltyPointsDifference =
      (cartItem.loyaltyPointsUsed ?? 0) -
      (existingCartItem?.loyaltyPointsUsed ?? 0)

    const updatedCart = await db.cart.update({
      where: { userId },
      data: {
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000), // extend expiry
        totalPriceInCents: { increment: priceDifference },
        totalLoyaltyPointsUsed: { increment: loyaltyPointsDifference },
        cartItems: {
          update: {
            where: { id: cartItem.id },
            data: {
              discountedAmountInCents: cartItem.discountedAmountInCents,
              itemPriceInCents: cartItem.itemPriceInCents,
              loyaltyPointsUsed: cartItem.loyaltyPointsUsed ?? null,
              // quantity: cartItem.quantity,
              customisations: {
                deleteMany: {},
                create: cartItem.customisations.map((customisation) => ({
                  customisation: { connect: { id: customisation.id } },
                  quantity: customisation.quantity,
                })),
              },
            },
          },
        },
      },
      include: {
        cartItems: {
          include: {
            dessert: {
              select: {
                id: true,
                name: true,
                chineseName: true,
                description: true,
                priceInCents: true,
                priceInLoyaltyPoints: true,
                imagePath: true,
                ingredients: { include: { ingredient: true } },
              },
            },
            customisations: { include: { customisation: true } },
          },
        },
      },
    })
    const cartItems = updatedCart.cartItems.map((item) => ({
      ...item,
      dessert: {
        ...item.dessert,
        ingredients: item.dessert.ingredients.map((i) => i.ingredient),
      },
      customisations: item.customisations.map((c) => ({
        ...c.customisation,
        quantity: c.quantity,
      })),
    }))
    res.status(200).json({ success: true, cartItems })
    return
  } catch (error) {
    console.error(error)
    res.status(500).json({ success: false, message: "Internal server error" })
    return
  }
}

export const incrementCartItem = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId
    if (!userId) {
      res.status(401).json({ message: "Unauthorised" })
      return
    }
    const { id } = req.body
    if (!id) {
      res.status(400).json({ message: "cartItemId is required" })
      return
    }
    const cartItem = await db.cartItem.findUnique({
      where: { id },
      select: { itemPriceInCents: true, loyaltyPointsUsed: true },
    })
    if (!cartItem) {
      res.status(404).json({ message: "Cart item not found" })
      return
    }
    const updatedCart = await db.cart.update({
      where: { userId },
      data: {
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000), // extend expiry
        totalLoyaltyPointsUsed: {
          increment: cartItem?.loyaltyPointsUsed ?? 0,
        },
        totalPriceInCents: { increment: cartItem?.itemPriceInCents ?? 0 },
        cartItems: {
          update: {
            where: { id },
            data: {
              quantity: { increment: 1 },
            },
          },
        },
      },
      include: {
        cartItems: {
          include: {
            dessert: {
              select: {
                id: true,
                name: true,
                chineseName: true,
                description: true,
                priceInCents: true,
                priceInLoyaltyPoints: true,
                imagePath: true,
                ingredients: { include: { ingredient: true } },
              },
            },
            customisations: { include: { customisation: true } },
          },
        },
      },
    })
    const cartItems = updatedCart.cartItems.map((item) => ({
      ...item,
      dessert: {
        ...item.dessert,
        ingredients: item.dessert.ingredients.map((i) => i.ingredient),
      },
      customisations: item.customisations.map((c) => ({
        ...c.customisation,
        quantity: c.quantity,
      })),
    }))
    res.status(200).json({ success: true, cartItems })
    return
  } catch (error) {
    console.error(error)
    res.status(500).json({ success: false, message: "Internal server error" })
    return
  }
}

export const decrementCartItem = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId
    if (!userId) {
      res.status(401).json({ message: "Unauthorised" })
      return
    }
    const { id } = req.body
    if (!id) {
      res.status(400).json({ message: "cartItemId is required" })
      return
    }
    const cartItem = await db.cartItem.findUnique({
      where: { id },
      select: {
        quantity: true,
        itemPriceInCents: true,
        loyaltyPointsUsed: true,
      },
    })
    if (!cartItem) {
      res.status(404).json({ message: "Cart item not found" })
      return
    }
    if (cartItem.quantity <= 1) {
      res.status(400).json({ message: "Quantity cannot be less than 1" })
      return
    }
    const updatedCart = await db.cart.update({
      where: { userId },
      data: {
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000), // extend expiry
        totalLoyaltyPointsUsed: {
          decrement: cartItem?.loyaltyPointsUsed ?? 0,
        },
        totalPriceInCents: { decrement: cartItem?.itemPriceInCents ?? 0 },
        cartItems: {
          update: {
            where: { id },
            data: {
              quantity: { decrement: 1 },
            },
          },
        },
      },
      include: {
        cartItems: {
          include: {
            dessert: {
              select: {
                id: true,
                name: true,
                chineseName: true,
                description: true,
                priceInCents: true,
                priceInLoyaltyPoints: true,
                imagePath: true,
                ingredients: { include: { ingredient: true } },
              },
            },
            customisations: { select: { quantity: true, customisation: true } },
          },
        },
      },
    })
    const cartItems = updatedCart.cartItems.map((item) => ({
      ...item,
      dessert: {
        ...item.dessert,
        ingredients: item.dessert.ingredients.map((i) => i.ingredient),
      },
      customisations: item.customisations.map((c) => ({
        ...c.customisation,
        quantity: c.quantity,
      })),
    }))
    res.status(200).json({ success: true, cartItems })
    return
  } catch (error) {
    console.error(error)
    res.status(500).json({ success: false, message: "Internal server error" })
    return
  }
}
