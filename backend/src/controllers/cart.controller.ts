import { randomUUID } from "node:crypto"
import { Request, Response } from "express"
import { db } from "../lib/db"
import { cartItemSchema, dessertSchema } from "../utils/schema"
import { Prisma, PrismaClient } from "@prisma/client"
import { DefaultArgs } from "@prisma/client/runtime/binary"
import {
  CartItemCustomisation,
  Dessert,
  Membership,
  AddCartItem,
  RawCartItem,
  CartItem,
} from "../types/types"
import {
  canRedeemAudience,
  isNewCustomer,
  offerRefusalMessage,
} from "../lib/offerAudience"

// function getNextMonday(fromDate = new Date()): Date {
//   const date = new Date(fromDate)
//   const day = date.getDay() // 0 = Sunday, 1 = Monday, ... 6 = Saturday
//   const daysUntilMonday = (8 - day) % 7 || 7 // ensures we always move forward
//   date.setDate(date.getDate() + daysUntilMonday)
//   date.setHours(0, 0, 0, 0) // optional: normalize to start of day
//   return date
// }

function calculateBestDiscount(
  cartItem: CartItem | AddCartItem,
  membership: Membership,
  itemPriceInCentsBeforeDiscount: number,
  dessert: Dessert,
) {
  let finalDiscountedAmount = 0

  const maxMembershipDiscount = Math.min(
    membership?.plan.maxDiscount ?? 0,
    (membership?.totalMonths ?? 1) * (membership?.plan.membershipDiscount ?? 0),
  )
  if (!cartItem.loyaltyPointsUsed) {
    const membershipDiscount = membership?.isActive // membership discount applies to dessert and customisatons
      ? itemPriceInCentsBeforeDiscount * (maxMembershipDiscount / 100)
      : 0
    const promoDiscount =
      dessert?.promo?.type === "PERCENTAGE"
        ? itemPriceInCentsBeforeDiscount * (dessert.promo.value / 100) // promo discounts only apply to dessert price, not customisations
        : dessert?.promo?.type === "FIXED_AMOUNT"
          ? dessert?.promo.value
          : 0
    finalDiscountedAmount = Math.max(membershipDiscount, promoDiscount)
  }
  return finalDiscountedAmount
}

export const redeemOfferForUser = async (
  userId: string,
  offerId: string,
  tx: Omit<
    PrismaClient<Prisma.PrismaClientOptions, never, DefaultArgs>,
    "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
  >,
) => {
  const offer = await tx.offer.findUnique({
    where: { id: offerId },
    include: { requirements: true },
  })
  if (!offer) throw new Error("Offer does not exist")
  const existing = await tx.offerRedemption.findUnique({
    where: {
      offerId_userId: { offerId, userId },
    },
  })

  if (existing) {
    if (existing.used >= offer.limit) {
      throw new Error("Offer usage limit reached")
    }

    if (offer.requirements.length > 0 && existing.status !== "AVAILABLE") {
      throw new Error("Requirements to unlock offer not met")
    }

    return await tx.offerRedemption.update({
      where: { id: existing.id },
      data: {
        used: { increment: 1 },
        redeemedAt: new Date(),
        status: "REDEEMED",
      },
    })
  }

  // Create new redemption
  return await tx.offerRedemption.create({
    data: {
      offerId,
      userId,
      used: 1,
      redeemedAt: new Date(),
      status: "REDEEMED",
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

    // The offer row joins this wave instead of following it. It does not
    // depend on the dessert or the membership; only the audience checks below
    // do, and those are local once all three have landed.
    const [dessert, membership, offer] = await Promise.all([
      db.dessert.findUnique({
        where: { id: cartItem.dessertId },
        include: {
          promo: true,
          category: {
            select: {
              name: true,
            },
          },
        },
      }),
      db.membership.findUnique({
        where: { userId },
        include: { plan: true },
      }),
      cartItem.offerId
        ? db.offer.findUnique({
            where: { id: cartItem.offerId },
            include: { dessert: true },
          })
        : Promise.resolve(null),
    ])

    if (!dessert) {
      res.status(404).json({ message: "Dessert not found" })
      return
    }

    if (cartItem.offerId) {
      if (!offer) {
        res.status(404).json({ message: "Offer may be expired or finished" })
        return
      }

      const viewer = {
        isActiveMember:
          !!membership &&
          membership.isActive &&
          membership.paymentStatus === "SUCCESS",
        // Only worth the query when the answer can change the outcome.
        isNewCustomer:
          offer.audience === "NEW_USERS" ? await isNewCustomer(userId) : false,
      }

      if (!canRedeemAudience(offer.audience, viewer)) {
        res.status(403).json({ message: offerRefusalMessage(offer.audience) })
        return
      }
    }

    const wantsNoGlutinous = cartItem.customisations.some(
      (c) => c.name === "Glutinous Balls" && c.quantity === 0,
    )
    const wantsNoMochi = cartItem.customisations.some(
      (c) => c.name === "Mochi" && c.quantity === 0,
    )

    let isMochiBowl = dessert?.category.name === "Mochi Series"

    const noMochi = isMochiBowl && wantsNoGlutinous && wantsNoMochi

    const itemPriceInCentsBeforeDiscount = Math.max(
      0,
      cartItem.itemPriceInCents - (noMochi ? 200 : 0),
    )

    // discount logic

    let finalDiscountedAmount = 0

    if (offer) {
      const offerPrice =
        offer?.itemPriceInCents !== null
          ? offer?.itemPriceInCents
          : offer.dessert
            ? offer.dessert.priceInCents *
              (1 - (Number(offer.discountAmount) ?? 0))
            : dessert
              ? dessert.priceInCents * (1 - (Number(offer.discountAmount) ?? 0))
              : 0

      finalDiscountedAmount = Math.max(
        0,
        Math.round(itemPriceInCentsBeforeDiscount - offerPrice),
      ) // this calculates the discount from member offers
    } else {
      finalDiscountedAmount = calculateBestDiscount(
        // this calculates the discounts on normal and promo items
        cartItem,
        membership,
        itemPriceInCentsBeforeDiscount,
        dessert,
      )
    }

    // calculate customisaton price

    const maxMembershipDiscount = Math.min(
      membership?.plan.maxDiscount ?? 0,
      (membership?.totalMonths ?? 1) *
        (membership?.plan.membershipDiscount ?? 0),
    )

    const cartItemData: Prisma.CartItemCreateWithoutCartInput = {
      dessert: {
        connect: {
          id: cartItem.dessertId, // Ensure dessert exists before connecting
        },
      },
      quantity: cartItem.quantity,
      itemPriceInCents: itemPriceInCentsBeforeDiscount, // get price from order item
      loyaltyPointsUsed: cartItem.loyaltyPointsUsed ?? null,
      discountedAmountInCents: Math.round(finalDiscountedAmount),
      customisations: {
        create: cartItem.customisations.map((cartItemCustomisation) => {
          return {
            customisation: {
              connect: {
                id: cartItemCustomisation.id, // Ensure customisation exists before connecting
              },
            },
            discountedAmountInCents:
              membership?.isActive && cartItemCustomisation.quantity > 0
                ? cartItemCustomisation.priceInCents *
                  (maxMembershipDiscount / 100)
                : 0,

            quantity: cartItemCustomisation.quantity,
          }
        }),
      },
    }

    if (cartItem.offerId) {
      cartItemData.offer = { connect: { id: cartItem.offerId } }
    }

    // create new cart item
    // let promotionEligible = false
    // await db.$transaction(async (tx) => {
    //   if (cart) {
    //     promotionEligible = await CheckMochiPromotion(
    //       cart.id,
    //       cartItem.dessertId,
    //       dessert.priceInCents,
    //       cartItem.itemPriceInCents,
    //       cartItem.customisations,
    //       tx,
    //     )
    //   }
    // })

    const cartExpiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000)
    const netPriceInCents = Math.round(
      itemPriceInCentsBeforeDiscount - finalDiscountedAmount,
    )
    const pointsSpent = cartItem.loyaltyPointsUsed ?? 0

    // Supplied rather than left to the database, so the row just written can be
    // read back by id in the same statement. The alternative — asking for the
    // newest item in the cart — is wrong the moment a customer adds two things
    // at once.
    const newCartItemId = randomUUID()

    // Creating the cart and adding to an existing one differ only in whether
    // the totals are set or incremented, which is exactly what upsert says.
    // This replaces a findUnique, a branch, an update and a create — four
    // round trips plus the transaction's own BEGIN and COMMIT — with one
    // statement that Prisma still applies atomically.
    const writeCartItem = async (client: Prisma.TransactionClient) => {
      const cart = await client.cart.upsert({
        where: { userId },
        create: {
          user: { connect: { id: userId } },
          expiresAt: cartExpiresAt,
          totalLoyaltyPointsUsed: pointsSpent,
          totalPriceInCents: netPriceInCents,
          cartItems: { create: { id: newCartItemId, ...cartItemData } },
        },
        update: {
          expiresAt: cartExpiresAt, // extend expiry
          totalLoyaltyPointsUsed: { increment: pointsSpent },
          totalPriceInCents: { increment: netPriceInCents },
          cartItems: { create: { id: newCartItemId, ...cartItemData } },
        },
        select: {
          cartItems: {
            where: { id: newCartItemId },
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
                  promo: true,
                },
              },
              customisations: { include: { customisation: true } },
            },
          },
        },
      })

      return cart.cartItems[0]
    }

    // Redeeming an offer and spending loyalty points have to succeed or fail
    // with the cart write, so those adds keep an interactive transaction. A
    // plain add has no such side effect and does not need one — which is the
    // common case, and the one the customer waits on.
    const needsAtomicSideEffects = Boolean(
      cartItem.offerId || cartItem.loyaltyPointsUsed,
    )

    const rawCartItem = needsAtomicSideEffects
      ? await db.$transaction(async (tx) => {
          // redeem offer
          //
          // Not conditional on a membership any more. It used to be, harmlessly,
          // because only a member could reach this line — but an open offer held
          // by a non-member would then be priced without ever writing a
          // redemption, so `used` would never increment and `limit` would never
          // be enforced.
          if (cartItem.offerId) {
            await redeemOfferForUser(userId, cartItem.offerId, tx)
          }

          // If user used loyalty points, deduct from their account
          if (cartItem.loyaltyPointsUsed) {
            const existing = await tx.loyalty.findUnique({
              where: { userId },
              select: { points: true },
            })

            if (!existing) throw new Error("User loyalty record not found")
            if (existing.points < cartItem.loyaltyPointsUsed) {
              throw new Error("INSUFFICIENT_LOYALTY_POINTS")
            }
            await tx.loyalty.update({
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

          return writeCartItem(tx)
        })
      : await writeCartItem(db)

    if (!rawCartItem) {
      res.status(500).json({ success: false, message: "Could not add to cart" })
      return
    }


    const formattedCartItem = {
      ...rawCartItem,
      dessert: {
        ...rawCartItem.dessert,
        ingredients: rawCartItem.dessert.ingredients.map((i) => i.ingredient),
      },
      customisations: rawCartItem.customisations.map((c) => ({
        ...c.customisation,
        discountedAmountInCents: c.discountedAmountInCents,
        quantity: c.quantity,
      })),
    }

    res.status(201).json({ success: true, cartItem: formattedCartItem })
    return
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "INSUFFICIENT_LOYALTY_POINTS"
    ) {
      res.status(400).json({
        message: "Insufficient loyalty points",
      })
      return
    }
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

    // Independent lookups, so they go together. Run in series this pair cost
    // two full database round trips on a request the app makes at every launch.
    const [cart, membership] = await Promise.all([
      db.cart.findUnique({
        where: { userId },
        select: {
          id: true,
          expiresAt: true,
          cartItems: {
            select: {
              id: true,
              offerId: true,
              loyaltyPointsUsed: true,
              // Needed below to tell a members-only item (which dies with a
              // lapsed membership) from one anybody may hold.
              offer: { select: { audience: true } },
            },
          },
        },
      }),
      db.membership.findUnique({ where: { userId } }),
    ])

    if (cart && cart.expiresAt && cart.expiresAt < new Date()) {
      const totalPointsToRefund = cart.cartItems.reduce((sum, item) => {
        return sum + (item.loyaltyPointsUsed ?? 0)
      }, 0)

      // An expired cart hands every held redemption back, whoever holds it.
      // The membership lookup this used to need is gone with the re-key — as
      // is the `break`, which abandoned the refund for every later item once
      // one lookup came up empty.
      //
      // The refund and the releases touch different tables and none depends on
      // another's result, so they are issued together. Awaited one at a time
      // this was a round trip per offer item before the cart could be deleted.
      await Promise.all([
        ...(totalPointsToRefund > 0
          ? [
              db.loyalty.update({
                where: { userId },
                data: {
                  points: { increment: totalPointsToRefund },
                  records: {
                    create: { change: totalPointsToRefund, reason: "REFUND" },
                  },
                },
              }),
            ]
          : []),
        ...cart.cartItems
          .filter((item) => item.offerId)
          .map((item) =>
            db.offerRedemption.updateMany({
              where: { offerId: item.offerId!, userId, used: { gt: 0 } },
              data: { used: { decrement: 1 } },
            }),
          ),
      ])

      await db.cart.delete({ where: { id: cart.id } })
      res.status(200).json({ success: true, message: "Cart expired" })
      return
    }

    let warning: string | null = null

    // A lapsed membership only invalidates the members-only offers. An offer
    // open to everyone (or to new customers) is still perfectly valid, so it
    // must survive — this used to delete every offer item indiscriminately,
    // which would strip a non-member's legitimate item on every cart load.
    if (!membership?.isActive && cart) {
      const memberOnlyItems = cart.cartItems.filter(
        (item) => item.offerId && item.offer?.audience === "MEMBERS",
      )

      if (memberOnlyItems.length > 0) {
        // Releases and the delete hit different tables, so they go together.
        const [, deletedItems] = await Promise.all([
          Promise.all(
            memberOnlyItems.map((item) =>
              db.offerRedemption.updateMany({
                where: { offerId: item.offerId!, userId, used: { gt: 0 } },
                data: { used: { decrement: 1 } },
              }),
            ),
          ),
          db.cartItem.deleteMany({
            where: { id: { in: memberOnlyItems.map((item) => item.id) } },
          }),
        ])

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
            promo: true,
          },
        },
        customisations: {
          select: {
            customisation: true,
            quantity: true,
            discountedAmountInCents: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    })

    const cartItems = rawCartItems.map((item) => ({
      ...item,
      dessert: {
        ...item.dessert,
        ingredients: item.dessert.ingredients.map((i) => i.ingredient),
      },
      customisations: item.customisations.map((c) => ({
        ...c.customisation,
        discountedAmountInCents: c.discountedAmountInCents,
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

    await db.$transaction(async (tx) => {
      if (totalPointsToRefund > 0) {
        await tx.loyalty.update({
          where: { userId },
          data: {
            points: { increment: totalPointsToRefund },
            records: {
              create: { change: totalPointsToRefund, reason: "REFUND" },
            },
          },
        })
      }

      // Clearing the cart hands back every held redemption. The per-item
      // membership lookup this used to do was both an N+1 and, via `break`,
      // a way to skip the refund for every item after the first miss.
      for (const item of cart.cartItems) {
        if (!item.offerId) continue
        await tx.offerRedemption.updateMany({
          where: {
            offerId: item.offerId,
            userId,
            used: { gt: 0 },
          },
          data: {
            used: { decrement: 1 },
          },
        })
      }

      await tx.cart.delete({ where: { userId } })
    })

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

    // No membership lookup: removing an item is not a membership-gated
    // action, and the redemption is keyed on the user now.
    const cartItem = await db.cartItem.findUnique({
      where: { id },
      select: {
        id: true,
        loyaltyPointsUsed: true,
        itemPriceInCents: true,
        offerId: true,
      },
    })

    if (!cartItem) {
      res.status(404).json({ message: "cart item not found" })
      return
    }

    await db.$transaction(async (tx) => {
      // This used to 403 with "No membership record found" when the user had
      // no membership, which left a non-member's open-offer item stuck in
      // their cart until it expired — they could add it but never remove it.
      if (cartItem.offerId) {
        await tx.offerRedemption.updateMany({
          where: {
            offerId: cartItem.offerId,
            userId,
            used: { gt: 0 },
          },
          data: {
            used: { decrement: 1 },
          },
        })
      }

      const updatedCart = await tx.cart.update({
        where: { userId },
        data: {
          expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
          totalLoyaltyPointsUsed: {
            decrement: cartItem.loyaltyPointsUsed ?? 0,
          },
          totalPriceInCents: {
            decrement: cartItem.itemPriceInCents,
          },
          cartItems: {
            delete: {
              id: cartItem.id,
            },
          },
        },
        select: {
          id: true,
          cartItems: {
            select: {
              id: true,
            },
          },
        },
      })

      // restore loyalty points if any were used

      if (cartItem.loyaltyPointsUsed) {
        await tx.loyalty.update({
          where: { userId },
          data: {
            points: {
              increment: cartItem.loyaltyPointsUsed,
            },
            records: {
              create: {
                change: cartItem.loyaltyPointsUsed,
                reason: "REFUND",
              },
            },
          },
        })
      }

      // delete cart if empty

      if (updatedCart.cartItems.length === 0) {
        await tx.cart.delete({
          where: { id: updatedCart.id },
        })
      }

      return cartItem.id
    })

    res.status(200).json({ success: true, id: cartItem.id })
    return
  } catch (error) {
    console.error(error)
    res.status(500).json({
      success: false,
      message: "Error removing item from cart",
    })
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

    const [dessert, existingCartItem, membership] = await Promise.all([
      db.dessert.findUnique({
        where: { id: cartItem.dessertId },
        include: { promo: true, category: true },
      }),
      db.cartItem.findUnique({
        where: { id: cartItem.id },
        select: {
          itemPriceInCents: true,
          loyaltyPointsUsed: true,
          quantity: true,
          customisations: {
            include: {
              customisation: true,
            },
          },
        },
      }),
      db.membership.findUnique({
        where: { userId },
        include: { plan: true },
      }),
    ])

    if (!dessert) {
      res.status(404).json({ message: "Dessert not found" })
      return
    }

    if (!existingCartItem) {
      res.status(404).json({ message: "Cart item not found" })
      return
    }

    const wantsNoGlutinous = cartItem.customisations.some(
      (c) => c.name === "Glutinous Balls" && c.quantity === 0, // user does not want balls
    )
    const wantsNoMochi = cartItem.customisations.some(
      // user does not want mochi
      (c) => c.name === "Mochi" && c.quantity === 0,
    )

    const existingCartHasNoBalls = existingCartItem.customisations.some(
      (c) => c.customisation.name === "Glutinous Balls" && c.quantity === 0,
    ) // existing mochi has no balls
    const existingCartHasNoMochi = existingCartItem.customisations.some(
      (c) => c.customisation.name === "Mochi" && c.quantity === 0,
    ) // existing mochi has no mochi

    let isMochiBowl = false

    if (wantsNoGlutinous && wantsNoMochi) {
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
      isMochiBowl &&
      existingCartHasNoBalls &&
      existingCartHasNoMochi &&
      !wantsNoGlutinous &&
      !wantsNoMochi // If existing cart has mochi and balls removed but new cart doesn't then user is trying to add it back

    const itemPriceInCentsBeforeDiscount = addBackMochi
      ? cartItem.itemPriceInCents + 200 // If user is trying to add mochi back, charge them $2
      : removeMochi
        ? Math.max(0, cartItem.itemPriceInCents - 200) // If user is removing mochi, minus $2
        : cartItem.itemPriceInCents // else normal price

    let finalDiscountedAmount = 0

    if (cartItem.offerId) {
      const offer = await db.offer.findUnique({
        where: { id: cartItem.offerId },
        include: { dessert: true },
      })
      if (!offer) {
        res.status(404).json({ message: "Offer may be expired or finished" })
        return
      }

      // Same audience check as addItemToCart. Without it this path would
      // reprice at offer rates for anyone the offer is not meant for.
      if (
        !canRedeemAudience(offer.audience, {
          isActiveMember:
            !!membership &&
            membership.isActive &&
            membership.paymentStatus === "SUCCESS",
          isNewCustomer:
            offer.audience === "NEW_USERS"
              ? await isNewCustomer(userId)
              : false,
        })
      ) {
        res.status(403).json({ message: offerRefusalMessage(offer.audience) })
        return
      }

      const offerPrice =
        offer?.itemPriceInCents !== null
          ? offer?.itemPriceInCents
          : offer.dessert
            ? offer.dessert.priceInCents *
              (1 - (Number(offer.discountAmount) ?? 0))
            : dessert
              ? dessert.priceInCents * (1 - (Number(offer.discountAmount) ?? 0))
              : 0

      finalDiscountedAmount = Math.max(
        0,
        Math.round(itemPriceInCentsBeforeDiscount - offerPrice),
      ) // this calculates the discount from the offer
    } else {
      finalDiscountedAmount = calculateBestDiscount(
        // this calculates the discounts on normal and promo items
        cartItem,
        membership,
        itemPriceInCentsBeforeDiscount,
        dessert,
      )
    }

    const newCustomisationPrice = cartItem.customisations.reduce(
      (sum, customisation) =>
        sum +
        (customisation.quantity > 0
          ? (customisation.priceInCents -
              customisation.discountedAmountInCents) *
            customisation.quantity
          : 0),
      0,
    )

    const oldCustomisationPrice = existingCartItem.customisations.reduce(
      (sum, customisation) =>
        sum +
        (customisation.quantity > 0
          ? (customisation.customisation.priceInCents -
              customisation.discountedAmountInCents) *
            customisation.quantity
          : 0),
      0,
    )
    // included customisations that want to be removed have their quantity as 0 therefore only count customisation where their quantity is > 0
    const newtotalCartItemPrice =
      itemPriceInCentsBeforeDiscount + newCustomisationPrice

    const oldtotalCartItemPrice =
      existingCartItem.itemPriceInCents + oldCustomisationPrice

    const priceDifference = newtotalCartItemPrice - oldtotalCartItemPrice

    const loyaltyPointsDifference =
      (cartItem.loyaltyPointsUsed ?? 0) -
      (existingCartItem?.loyaltyPointsUsed ?? 0)

    await db.cart.update({
      where: { userId },
      data: {
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000), // extend expiry
        totalPriceInCents: { increment: priceDifference },
        totalLoyaltyPointsUsed: { increment: loyaltyPointsDifference },
        cartItems: {
          update: {
            where: { id: cartItem.id },
            data: {
              itemPriceInCents: itemPriceInCentsBeforeDiscount, // get price from order item
              discountedAmountInCents: Math.round(finalDiscountedAmount),
              loyaltyPointsUsed: cartItem.loyaltyPointsUsed ?? null,
              // quantity: cartItem.quantity,
              customisations: {
                deleteMany: {},
                create: cartItem.customisations.map((customisation) => {
                  const maxMembershipDiscount = Math.min(
                    membership?.plan.maxDiscount ?? 0,
                    (membership?.totalMonths ?? 1) *
                      (membership?.plan.membershipDiscount ?? 0),
                  )

                  return {
                    customisation: { connect: { id: customisation.id } },
                    discountedAmountInCents:
                      membership?.isActive && customisation.quantity > 0
                        ? customisation.priceInCents *
                          (maxMembershipDiscount / 100)
                        : 0,

                    quantity: customisation.quantity,
                  }
                }),
              },
            },
          },
        },
      },
      select: { id: true },
    })

    const updatedItem = await db.cartItem.findUnique({
      where: {
        id: cartItem.id,
      },

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
            promo: true,
          },
        },
        customisations: { include: { customisation: true } },
      },
    })

    if (!updatedItem) {
      res
        .status(404)
        .json({ success: false, message: "Could not find updated cart item" })
      return
    }
    const UpdatedCartItem = {
      ...updatedItem,
      dessert: {
        ...updatedItem.dessert,
        ingredients: updatedItem.dessert.ingredients.map((i) => i.ingredient),
      },
      customisations: updatedItem.customisations.map((c) => ({
        ...c.customisation,
        discountedAmountInCents: c.discountedAmountInCents,
        quantity: c.quantity,
      })),
    }
    res.status(200).json({ success: true, cartItem: UpdatedCartItem })
    return
  } catch (error) {
    console.error(error)
    res.status(500).json({ success: false, message: "Internal server error" })
    return
  }
}

export const updateCartItemQuantity = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId
    if (!userId) {
      res.status(401).json({ message: "Unauthorised" })
      return
    }
    const { id, quantity } = req.body ?? {}
    if (!id) {
      res.status(400).json({ message: "cartItemId is required" })
      return
    }
    // Number.isInteger rather than typeof: 2.5 and 1e12 are both numbers, and
    // both reach Prisma as an Int it can't store, turning a bad request into a
    // 500.
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      res.status(400).json({ message: "A valid quantity is required" })
      return
    }
    const cartItem = await db.cartItem.findUnique({
      where: { id },
      select: {
        id: true,
        cartId: true,
        itemPriceInCents: true,
        loyaltyPointsUsed: true,
        quantity: true,

        offerId: true,
        customisations: {
          select: {
            customisation: {
              select: {
                id: true,
                name: true,
                chineseName: true,
                priceInCents: true,
              },
            },
            quantity: true,
            discountedAmountInCents: true,
          },
        },
      },
    })

    if (!cartItem) {
      res.status(404).json({ message: "Cart item not found" })
      return
    }

    if (cartItem.offerId) {
      res.status(404).json({ message: "Cannot change offer quantity" })
      return
    }

    const customisationPrice = cartItem.customisations.reduce(
      (sum, customisation) =>
        sum +
        (customisation.quantity > 0
          ? (customisation.customisation.priceInCents -
              customisation.discountedAmountInCents) *
            customisation.quantity
          : 0),
      0,
    )
    // included customisations that want to be removed have their quantity as 0 therefore only count customisation where their quantity is > 0
    const newtotalCartItemPrice =
      (cartItem.itemPriceInCents + customisationPrice) * quantity
    const oldTtotalItemPrice =
      (cartItem.itemPriceInCents + customisationPrice) * cartItem.quantity
    const priceDifference = newtotalCartItemPrice - oldTtotalItemPrice

    // One statement. This used to open a transaction, update the cart — whose
    // nested cartItems update already applied the new quantity — and then
    // update that same row a second time purely to read it back with its
    // relations. Four round trips, on the button customers press most, against
    // a database where each one costs the better part of a second.
    const updatedCart = await db.cart.update({
      where: { userId },
      data: {
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000), // extend expiry
        totalLoyaltyPointsUsed: {
          increment: cartItem?.loyaltyPointsUsed ?? 0,
        },
        totalPriceInCents: { increment: priceDifference ?? 0 },
        cartItems: {
          update: {
            where: { id },
            data: { quantity },
          },
        },
      },
      select: {
        cartItems: {
          where: { id },
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
                promo: true,
              },
            },
            customisations: { include: { customisation: true } },
          },
        },
      },
    })

    const updatedCartItem = updatedCart.cartItems[0]

    if (!updatedCartItem) {
      res.status(404).json({ message: "Cart item not found" })
      return
    }

    const formattedCartItem = {
      ...updatedCartItem,
      dessert: {
        ...updatedCartItem.dessert,
        ingredients: updatedCartItem.dessert.ingredients.map(
          (i) => i.ingredient,
        ),
      },
      customisations: updatedCartItem.customisations.map((c) => ({
        ...c.customisation,
        discountedAmountInCents: c.discountedAmountInCents,
        quantity: c.quantity,
      })),
    }

    res.status(200).json({ success: true, cartItem: formattedCartItem })
    return
  } catch (error) {
    console.error(error)
    res.status(500).json({ success: false, message: error })
    return
  }
}

// export const incrementCartItem = async (req: Request, res: Response) => {
//   try {
//     const userId = (req as any).userId
//     if (!userId) {
//       res.status(401).json({ message: "Unauthorised" })
//       return
//     }
//     const { id } = req.body
//     if (!id) {
//       res.status(400).json({ message: "cartItemId is required" })
//       return
//     }
//     const cartItem = await db.cartItem.findUnique({
//       where: { id },
//       select: {
//         cartId: true,
//         itemPriceInCents: true,
//         loyaltyPointsUsed: true,
//         quantity: true,
//         dessertId: true,
//         offerId: true,
//       },
//     })
//     if (!cartItem) {
//       res.status(404).json({ message: "Cart item not found" })
//       return
//     }

//     if (cartItem.offerId) {
//       res.status(404).json({ message: "Cannot increment offers" })
//       return
//     }

//     const { upserted } = await CheckMochiPromotion(
//       cartItem.cartId,
//       cartItem.dessertId
//     )

//     if (!upserted) {
//       await db.cart.update({
//         where: { userId },
//         data: {
//           expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000), // extend expiry
//           totalLoyaltyPointsUsed: {
//             increment: cartItem?.loyaltyPointsUsed ?? 0,
//           },
//           totalPriceInCents: { increment: cartItem?.itemPriceInCents ?? 0 },
//           cartItems: {
//             update: {
//               where: { id },
//               data: {
//                 quantity: { increment: 1 },
//               },
//             },
//           },
//         },
//       })
//     }

//     const newCartItems = await db.cartItem.findMany({
//       where: { cartId: cartItem.cartId },
//       include: {
//         dessert: {
//           select: {
//             id: true,
//             name: true,
//             chineseName: true,
//             description: true,
//             priceInCents: true,
//             priceInLoyaltyPoints: true,
//             imagePath: true,
//             ingredients: { include: { ingredient: true } },
//           },
//         },
//         customisations: { include: { customisation: true } },
//       },
//       orderBy: { createdAt: "asc" },
//     })
//     const cartItems = newCartItems.map((item) => ({
//       ...item,
//       dessert: {
//         ...item.dessert,
//         ingredients: item.dessert.ingredients.map((i) => i.ingredient),
//       },
//       customisations: item.customisations.map((c) => ({
//         ...c.customisation,
//         quantity: c.quantity,
//       })),
//     }))
//     console.log(cartItems)
//     res.status(200).json({ success: true, cartItems })
//     return
//   } catch (error) {
//     console.error(error)
//     res.status(500).json({ success: false, message: "Internal server error" })
//     return
//   }
// }

// export const decrementCartItem = async (req: Request, res: Response) => {
//   try {
//     const userId = (req as any).userId
//     if (!userId) {
//       res.status(401).json({ message: "Unauthorised" })
//       return
//     }
//     const { id } = req.body
//     if (!id) {
//       res.status(400).json({ message: "cartItemId is required" })
//       return
//     }
//     const cartItem = await db.cartItem.findUnique({
//       where: { id },
//       select: {
//         cartId: true,
//         dessertId: true,
//         quantity: true,
//         itemPriceInCents: true,
//         loyaltyPointsUsed: true,
//       },
//     })
//     if (!cartItem) {
//       res.status(404).json({ message: "Cart item not found" })
//       return
//     }
//     if (cartItem.quantity <= 1) {
//       res.status(400).json({ message: "Quantity cannot be less than 1" })
//       return
//     }
//     const updatedCart = await db.cart.update({
//       where: { userId },
//       data: {
//         expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000), // extend expiry
//         totalLoyaltyPointsUsed: {
//           decrement: cartItem?.loyaltyPointsUsed ?? 0,
//         },
//         totalPriceInCents: { decrement: cartItem?.itemPriceInCents ?? 0 },
//         cartItems: {
//           update: {
//             where: { id },
//             data: {
//               quantity: { decrement: 1 },
//             },
//           },
//         },
//       },
//     })

//     await CheckMochiPromotion(cartItem.cartId, cartItem.dessertId)

//     const newCartItems = await db.cartItem.findMany({
//       where: { cartId: cartItem.cartId },
//       include: {
//         dessert: {
//           select: {
//             id: true,
//             name: true,
//             chineseName: true,
//             description: true,
//             priceInCents: true,
//             priceInLoyaltyPoints: true,
//             imagePath: true,
//             ingredients: { include: { ingredient: true } },
//           },
//         },
//         customisations: { include: { customisation: true } },
//       },
//       orderBy: { createdAt: "asc" },
//     })

//     const cartItems = newCartItems.map((item) => ({
//       ...item,
//       dessert: {
//         ...item.dessert,
//         ingredients: item.dessert.ingredients.map((i) => i.ingredient),
//       },
//       customisations: item.customisations.map((c) => ({
//         ...c.customisation,
//         quantity: c.quantity,
//       })),
//     }))
//     res.status(200).json({ success: true, cartItems })
//     return
//   } catch (error) {
//     console.error(error)
//     res.status(500).json({ success: false, message: "Internal server error" })
//     return
//   }
// }
