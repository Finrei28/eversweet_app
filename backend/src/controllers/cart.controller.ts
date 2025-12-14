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

const CheckMochiPromotion = async (cartId: string, dessertId: string) => {
  try {
    const totalMochiItems = await db.cartItem.findMany({
      where: {
        cartId,
        isPromotionItem: false, // only real items
        dessert: {
          category: { name: "Mochi Series" },
        },
      },
      select: { quantity: true },
    })
    const totalDiscountedItems = await db.cartItem.findMany({
      where: {
        cartId,
        isPromotionItem: true, // only real items
        dessert: {
          category: { name: "Mochi Series" },
        },
      },
      select: { id: true, quantity: true },
    })
    const totalMochiCount = totalMochiItems.reduce(
      (acc, item) => acc + item.quantity,
      0
    )
    const allowedPromotions = Math.floor(totalMochiCount / 4)
    const totalDiscountedCount = totalDiscountedItems.reduce(
      (acc, item) => acc + item.quantity,
      0
    )
    console.log(totalMochiCount)
    console.log(allowedPromotions)
    console.log(totalDiscountedCount)
    if (totalMochiCount >= 4 && allowedPromotions > totalDiscountedCount) {
      // valid for mochi promotional discount
      await db.cartItem.upsert({
        where: {
          cartId_promotionType_dessertId: {
            cartId,
            promotionType: "MOCHI_4_PACK",
            dessertId,
          },
        },
        create: {
          cartId: cartId,
          dessertId,
          isPromotionItem: true,
          promotionType: "MOCHI_4_PACK",
          quantity: 1,
          itemPriceInCents: 999,
          discountedAmountInCents: 999,
        },
        update: {
          quantity: { increment: 1 },
        },
      })
      return { upserted: true }
    } else if (totalMochiCount < 4) {
      await db.cartItem.deleteMany({
        where: {
          cartId: cartId,
          promotionType: "MOCHI_4_PACK",
          isPromotionItem: true,
        },
      })
    } else if (totalDiscountedCount > allowedPromotions) {
      let excess = totalDiscountedCount - Math.floor(totalMochiCount / 4)

      if (excess > 0) {
        // Get promo items sorted oldest-first for consistent removal
        const promoItems = await db.cartItem.findMany({
          where: {
            cartId,
            promotionType: "MOCHI_4_PACK",
            isPromotionItem: true,
          },
          orderBy: { createdAt: "asc" },
          select: { id: true, quantity: true },
        })

        for (const item of promoItems) {
          if (excess <= 0) break

          if (item.quantity > excess) {
            // Case 1: Decrement quantity
            await db.cartItem.update({
              where: { id: item.id },
              data: { quantity: item.quantity - excess },
            })

            excess = 0 // fully applied
          } else {
            // Case 2: Quantity is <= excess → delete the whole row
            await db.cartItem.delete({
              where: { id: item.id },
            })

            excess -= item.quantity // reduce by deleted quantity
          }
        }
      }
    }
    return { upserted: false }
  } catch (error) {
    throw new Error("failed to Check Mochi Promotion")
  }
}

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

    const membership = await db.membership.findUnique({ where: { userId } })
    if (cartItem.offerId) {
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
          records: {
            create: {
              change: -cartItem.loyaltyPointsUsed,
              reason: "REWARDS",
            },
          },
        },
      })
    }

    const wantsNoGlutinous = cartItem.customisations.some(
      (c) => c.name === "Glutinous Balls" && c.quantity === 0
    )
    const wantsNoMochi = cartItem.customisations.some(
      (c) => c.name === "Mochi" && c.quantity === 0
    )

    let isMochiBowl = false

    if (wantsNoGlutinous && wantsNoMochi) {
      const dessert = await db.dessert.findUnique({
        where: { id: cartItem.dessertId },
        select: { category: true },
      })
      if (dessert?.category.name === "Mochi Series") {
        isMochiBowl = true
      }
    }

    const noMochi = isMochiBowl && wantsNoGlutinous && wantsNoMochi

    const finalItemPriceInCents =
      cartItem.itemPriceInCents - (noMochi ? 200 : 0)

    const discountedAmount =
      membership?.isActive && !cartItem.offerId && cartItem.itemPriceInCents > 0
        ? Math.round(finalItemPriceInCents * 0.15)
        : 0

    let cart = await db.cart.findUnique({
      where: { userId },
      select: {
        id: true,
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
      itemPriceInCents: cartItem.itemPriceInCents - (noMochi ? 200 : 0), // get price from order item
      loyaltyPointsUsed: cartItem.loyaltyPointsUsed ?? null,
      discountedAmountInCents: discountedAmount,
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
          id: true,
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
      const { upserted } = await CheckMochiPromotion(
        cart.id,
        cartItem.dessertId
      )
      if (!upserted) {
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
            id: true,
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
    }

    const newCartItems = await db.cartItem.findMany({
      where: { cartId: cart.id },
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
      orderBy: { createdAt: "asc" },
    })

    const cartItems = newCartItems.map((item) => ({
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
          data: {
            points: { increment: totalPointsToRefund },
            records: {
              create: { change: totalPointsToRefund, reason: "REFUND" },
            },
          },
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
              used: { gt: 0 },
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
                used: { gt: 0 },
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
            "One or more items in your cart requires an active membership. These items have been removed from your cart."
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
        data: {
          points: { increment: totalPointsToRefund },
          records: {
            create: { change: totalPointsToRefund, reason: "REFUND" },
          },
        },
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
            used: { gt: 0 },
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
        dessertId: true,
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
          used: { gt: 0 },
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
    })

    await CheckMochiPromotion(updatedCart.id, cartItem.dessertId)

    const newCartItems = await db.cartItem.findMany({
      where: { cartId: updatedCart.id },
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
      orderBy: { createdAt: "asc" },
    })
    // restore loyalty points if any were used
    if (cartItem && cartItem.loyaltyPointsUsed) {
      await db.loyalty.update({
        where: { userId },
        data: {
          points: {
            increment: cartItem.loyaltyPointsUsed,
          },
          records: {
            create: { change: cartItem.loyaltyPointsUsed, reason: "REFUND" },
          },
        },
      })
    }
    // delete cart if empty
    if (newCartItems && newCartItems.length === 0) {
      await db.cart.delete({ where: { id: updatedCart.id } })
    }
    const cartItems = newCartItems.map((item) => ({
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
        customisations: { include: { customisation: true } },
      },
    })

    if (!existingCartItem) {
      res.status(404).json({ message: "Cart item not found" })
      return
    }

    const wantsNoGlutinous = cartItem.customisations.some(
      (c) => c.name === "Glutinous Balls" && c.quantity === 0 // user does not want balls
    )
    const wantsNoMochi = cartItem.customisations.some(
      // user does not want mochi
      (c) => c.name === "Mochi" && c.quantity === 0
    )

    const existingCartHasNoBalls = existingCartItem.customisations.some(
      (c) => c.customisation.name === "Glutinous Balls" && c.quantity === 0
    ) // existing mochi has no balls
    const existingCartHasNoMochi = existingCartItem.customisations.some(
      (c) => c.customisation.name === "Mochi" && c.quantity === 0
    ) // existing mochi has no mochi

    let isMochiBowl = false

    if (wantsNoGlutinous && wantsNoMochi) {
      const dessert = await db.dessert.findUnique({
        where: { id: cartItem.dessertId },
        select: { category: true },
      })
      if (dessert?.category.name === "Mochi Series") {
        isMochiBowl = true
      }
    }

    const removeMochi =
      isMochiBowl &&
      wantsNoGlutinous &&
      wantsNoMochi &&
      !existingCartHasNoBalls &&
      !existingCartHasNoMochi
    const addBackMochi =
      existingCartHasNoBalls &&
      existingCartHasNoMochi &&
      !wantsNoGlutinous &&
      !wantsNoMochi // If there was no mochi but now is then user is trying to add it back

    const membership = await db.membership.findUnique({ where: { userId } })

    const finalItemPriceInCents = addBackMochi
      ? cartItem.itemPriceInCents + 200 // If user is trying to add mochi back, charge them $2
      : removeMochi
        ? cartItem.itemPriceInCents - 200 // If user is removing mochi, minus $2
        : cartItem.itemPriceInCents // else normal price

    const discountedAmount =
      membership?.isActive && !cartItem.offerId && cartItem.itemPriceInCents > 0
        ? Math.round(finalItemPriceInCents * 0.15)
        : 0

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
              itemPriceInCents: finalItemPriceInCents, // get price from order item
              discountedAmountInCents: discountedAmount,
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
      select: {
        cartId: true,
        itemPriceInCents: true,
        loyaltyPointsUsed: true,
        quantity: true,
        dessertId: true,
        offerId: true,
      },
    })
    if (!cartItem) {
      res.status(404).json({ message: "Cart item not found" })
      return
    }

    if (cartItem.offerId) {
      res.status(404).json({ message: "Cannot increment offers" })
      return
    }

    const { upserted } = await CheckMochiPromotion(
      cartItem.cartId,
      cartItem.dessertId
    )

    if (!upserted) {
      await db.cart.update({
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
      })
    }

    const newCartItems = await db.cartItem.findMany({
      where: { cartId: cartItem.cartId },
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
      orderBy: { createdAt: "asc" },
    })
    const cartItems = newCartItems.map((item) => ({
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
    console.log(cartItems)
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
        cartId: true,
        dessertId: true,
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
    })

    await CheckMochiPromotion(cartItem.cartId, cartItem.dessertId)

    const newCartItems = await db.cartItem.findMany({
      where: { cartId: cartItem.cartId },
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
      orderBy: { createdAt: "asc" },
    })

    const cartItems = newCartItems.map((item) => ({
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
