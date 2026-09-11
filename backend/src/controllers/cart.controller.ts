import { randomUUID } from "node:crypto"
import { Request, Response } from "express"
import { db, DbTransactionClient } from "../lib/db"
import { cartItemSchema, dessertSchema } from "../utils/schema"
import { Prisma } from "@prisma/client"
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
import { isOfferLive } from "../lib/offerAvailability"
import { offerUnitPriceInCents } from "../lib/offerPricing"

/**
 * Handing a held redemption back, as one `data` block because all four release paths -
 * removing an item, clearing the cart, the cart expiring, and a membership lapsing -
 * have to agree.
 *
 * `status` goes with `used`. Releasing used to move the counter alone, which was
 * harmless only while `status` was written REDEEMED on every use; now that it means
 * "used up", leaving it behind would lock a gated offer out for good the first time
 * somebody changed their mind. AVAILABLE is unconditionally right here: redeeming
 * refuses at `used >= limit`, so `used <= limit` always, and every release below is
 * guarded by `used > 0` - so afterwards `used <= limit - 1`, which is short of the limit.
 */
const RELEASE_REDEMPTION = {
  used: { decrement: 1 },
  status: "AVAILABLE",
} as const

/**
 * A refusal the customer should be told about, thrown from inside the cart transaction.
 *
 * `redeemOfferForUser` threw plain Errors, which land in the generic catch and come back
 * as "Internal server error" - so tapping Redeem on an offer that had just run out said
 * the server was broken. The app takes the server's message as the single source of
 * truth for a rejected offer (see the comment in the app's store/cart.ts), so the reason
 * has to survive the trip.
 */
export class OfferUnavailableError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "OfferUnavailableError"
  }
}

// function getNextMonday(fromDate = new Date()): Date {
//   const date = new Date(fromDate)
//   const day = date.getDay() // 0 = Sunday, 1 = Monday, ... 6 = Saturday
//   const daysUntilMonday = (8 - day) % 7 || 7 // ensures we always move forward
//   date.setDate(date.getDate() + daysUntilMonday)
//   date.setHours(0, 0, 0, 0) // optional: normalize to start of day
//   return date
// }

/**
 * Prisma defaults an interactive transaction to 5s. A round trip to this
 * database costs the better part of a second, so a transaction making five or
 * six of them can exceed that as soon as two requests overlap — which is
 * exactly how adding two items quickly used to fail, with P2028 "transaction
 * already closed" after 5182ms. The work inside these transactions is small;
 * the time goes on waiting for the network, so the bound has to be set for a
 * remote database rather than a local one.
 */
const TRANSACTION_OPTIONS = { timeout: 20_000, maxWait: 10_000 }

/**
 * The order every cart transaction takes its row locks in:
 *
 *   OfferRedemption  ->  Loyalty  ->  Cart
 *
 * Postgres deadlocks when two transactions want the same rows in opposite
 * orders, and that is what adding and removing used to do. An add debited
 * Loyalty and then wrote Cart; a remove wrote Cart and then refunded Loyalty.
 * Tapping the two quickly enough to overlap left each holding the row the
 * other was waiting on, and Postgres killed one with 40P01.
 *
 * The rule is only that everything agrees, not what the order is. This is the
 * order addItemToCart already followed, so it is the one that spread.
 *
 * Anything touching more than one of these tables in a transaction has to
 * follow it. Nothing enforces that but this comment and the tests.
 */

/** Postgres's deadlock code, which Prisma surfaces without mapping. */
const isDeadlock = (error: unknown) =>
  error instanceof Error && error.message.includes("40P01")

/**
 * The two codes a lost race to create the first cart can arrive as.
 *
 * P2002 is the obvious one: both adds took upsert's create branch and one lost
 * the unique index on Cart.userId.
 *
 * P2014 is the same race wearing a different hat, and missing it is what made
 * four simultaneous adds return a 500. `Cart.user` is a required one-to-one, so
 * when the loser's `create` runs after the winner has committed, Prisma reads
 * its `connect` as detaching the cart the winner just made and reports a
 * violated relation instead of a duplicate key. Nothing is wrong with the
 * request - the cart it wanted to create simply already exists - so it retries
 * on exactly the same reasoning as P2002.
 */
const isCartCreateConflict = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  (error.code === "P2002" || error.code === "P2014")

/**
 * Runs `work`, retrying once for the conflicts that are a normal part of
 * concurrent cart writes rather than a fault.
 *
 * P2002 / P2014: two adds racing to create the same customer's first cart. The
 * cart exists by the time the loser retries, so the retry takes the update
 * branch. See `isCartCreateConflict` for why one race produces two codes.
 *
 * 40P01: a deadlock. Consistent lock ordering makes these rare rather than
 * impossible - Postgres can still pick a victim when index or tuple locks
 * collide - and the loser is rolled back whole, so retrying is the correct
 * response rather than a way of hiding it.
 *
 * Either way the failed transaction committed nothing, so re-running it cannot
 * double up an offer redemption or a points debit.
 */
const retryOnCartConflict = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work()
  } catch (error) {
    if (isCartCreateConflict(error) || isDeadlock(error)) {
      return work()
    }

    throw error
  }
}


/**
 * What the customer asked for, priced by the database rather than by them.
 *
 * The request carries a name and a price for every customisation, and both
 * used to be believed. The price set the membership discount stored against
 * the line, and `calculateCartPrice` subtracts that stored discount from the
 * real price at checkout — so claiming a $50 topping bought a $50 discount off
 * the rest of the order. The name decides the mochi-bowl adjustment further
 * down, which is worth $2 to anyone willing to rename a topping.
 *
 * Ids are the only part of the request worth trusting, because the database
 * can check them.
 */
type RequestedCustomisation = { id: string; quantity: number }
type ResolvedCustomisation = {
  id: string
  name: string
  priceInCents: number
  quantity: number
}

const loadCustomisations = (requested: RequestedCustomisation[]) =>
  requested.length > 0
    ? db.ingredient.findMany({
        where: { id: { in: requested.map((c) => c.id) } },
        select: { id: true, name: true, priceInCents: true },
      })
    : Promise.resolve([])

/**
 * Returns null when the request names a customisation that does not exist,
 * which is a bad request rather than something to price around.
 */
const resolveCustomisations = (
  requested: RequestedCustomisation[],
  rows: { id: string; name: string; priceInCents: number }[],
): ResolvedCustomisation[] | null => {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const resolved: ResolvedCustomisation[] = []

  for (const c of requested) {
    const row = byId.get(c.id)
    if (!row) return null

    resolved.push({
      id: row.id,
      name: row.name,
      priceInCents: row.priceInCents,
      quantity: c.quantity,
    })
  }

  return resolved
}

/**
 * A mochi bowl with both the glutinous balls and the mochi taken out costs $2
 * less. Decided on the database's names, never the request's.
 */
const mochiAdjustmentInCents = (
  customisations: ResolvedCustomisation[],
  categoryName: string,
) => {
  if (categoryName !== "Mochi Series") return 0

  const removed = (name: string) =>
    customisations.some((c) => c.name === name && c.quantity === 0)

  return removed("Glutinous Balls") && removed("Mochi") ? 200 : 0
}

/**
 * The membership discount on the customisations of one line, priced from the
 * database rows.
 */
const customisationDiscount = (
  customisation: ResolvedCustomisation,
  membership: Membership,
  maxMembershipDiscount: number,
) =>
  membership?.isActive && customisation.quantity > 0
    ? customisation.priceInCents * (maxMembershipDiscount / 100)
    : 0

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
  tx: DbTransactionClient,
) => {
  const offer = await tx.offer.findUnique({
    where: { id: offerId },
    include: { requirements: true },
  })
  if (!offer) throw new OfferUnavailableError("Offer does not exist", 404)
  // Offers are never deleted - archiving is the supported way to retire one - so the
  // check above has never actually refused anything. This is the one that does.
  if (!isOfferLive(offer)) {
    throw new OfferUnavailableError("Offer may be expired or finished", 404)
  }

  const existing = await tx.offerRedemption.findUnique({
    where: {
      offerId_userId: { offerId, userId },
    },
  })

  // REDEEMED only at the limit. Writing it on every use meant the gate below refused
  // the second use whatever `limit` said, so `limit > 1` was meaningless on any offer
  // carrying requirements.
  const statusAfter = (used: number) =>
    used >= offer.limit ? ("REDEEMED" as const) : ("AVAILABLE" as const)

  if (existing) {
    if (existing.used >= offer.limit) {
      throw new OfferUnavailableError("You have used this offer already", 409)
    }

    if (offer.requirements.length > 0 && existing.status !== "AVAILABLE") {
      throw new OfferUnavailableError(
        "Place a qualifying order to unlock this offer",
        409,
      )
    }

    return await tx.offerRedemption.update({
      where: { id: existing.id },
      data: {
        used: { increment: 1 },
        redeemedAt: new Date(),
        status: statusAfter(existing.used + 1),
      },
    })
  }

  // No row means nobody has unlocked this for them. The branch below used to create one
  // outright, skipping the requirement check entirely, so a gated offer could be taken
  // once by POSTing its id straight at addItemToCart - unreachable through the UI only
  // because the button is hidden. It matters more now that the admin's Close run
  // *deletes* these rows: a deleted row is exactly this state.
  if (offer.requirements.length > 0) {
    throw new OfferUnavailableError(
      "Place a qualifying order to unlock this offer",
      409,
    )
  }

  // Create new redemption
  return await tx.offerRedemption.create({
    data: {
      offerId,
      userId,
      used: 1,
      redeemedAt: new Date(),
      status: statusAfter(1),
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
    //
    // The customisations come too. What they cost and what they are called
    // both decide money below, and neither may be taken from the request —
    // see `resolveCustomisations`. Same wave, so no extra round trip.
    const [dessert, membership, offer, customisationRows] = await Promise.all([
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
      loadCustomisations(cartItem.customisations),
    ])

    if (!dessert) {
      res.status(404).json({ message: "Dessert not found" })
      return
    }

    const customisations = resolveCustomisations(
      cartItem.customisations,
      customisationRows,
    )

    if (!customisations) {
      res.status(400).json({ message: "Unknown customisation" })
      return
    }

    if (cartItem.offerId) {
      // `!offer` never fires - offers are archived, never deleted - so until the dates
      // and archivedAt landed here a paused or expired offer still repriced the item.
      if (!offer || !isOfferLive(offer)) {
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

    // A redemption is signalled by the points being present, and what it costs
    // is the dessert's price in points — not a figure the customer sends.
    // Sending 1 for a 500-point reward used to buy it for 1.
    const pointsRequested = cartItem.loyaltyPointsUsed ?? 0
    const isRedemption = pointsRequested > 0

    if (isRedemption && pointsRequested !== dessert.priceInLoyaltyPoints) {
      res
        .status(400)
        .json({ message: "That reward costs a different number of points" })
      return
    }

    // The list price comes from the dessert row rather than the request. The
    // app only ever sent `dessert.priceInCents` back to us, so nothing
    // legitimate changes — but `itemPriceInCents: 0` no longer buys a $12
    // dessert for nothing.
    const listPriceInCents = isRedemption ? 0 : dessert.priceInCents

    const itemPriceInCentsBeforeDiscount = Math.max(
      0,
      listPriceInCents -
        mochiAdjustmentInCents(customisations, dessert.category.name),
    )

    // discount logic

    let finalDiscountedAmount = 0

    if (offer) {
      finalDiscountedAmount = Math.max(
        0,
        itemPriceInCentsBeforeDiscount - offerUnitPriceInCents(offer, dessert),
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
      loyaltyPointsUsed: isRedemption ? dessert.priceInLoyaltyPoints : null,
      discountedAmountInCents: Math.round(finalDiscountedAmount),
      customisations: {
        create: customisations.map((cartItemCustomisation) => {
          return {
            customisation: {
              connect: {
                id: cartItemCustomisation.id, // Ensure customisation exists before connecting
              },
            },
            discountedAmountInCents: customisationDiscount(
              cartItemCustomisation,
              membership,
              maxMembershipDiscount,
            ),

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
    const pointsSpent = isRedemption ? dessert.priceInLoyaltyPoints : 0

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
    const writeCartItem = async (client: DbTransactionClient) => {
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
    const needsAtomicSideEffects = Boolean(cartItem.offerId || isRedemption)

    const rawCartItem = needsAtomicSideEffects
      ? await retryOnCartConflict(() =>
          db.$transaction(async (tx) => {
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

            // Spend the points only if they are there, in one statement.
            //
            // Reading the balance and then writing it is check-then-act: two
            // redemptions arriving together both read a sufficient balance,
            // both subtract, and the customer ends up with fewer points than
            // they had - or below zero - for one reward's worth of desserts.
            // A filter beside the unique field makes the check and the debit
            // the same operation, so the loser matches no row.
            //
            // It also drops a round trip from the slowest add in the app,
            // which is the reason a redemption felt slower than a plain one.
            if (isRedemption) {
              try {
                await tx.loyalty.update({
                  where: { userId, points: { gte: pointsSpent } },
                  data: {
                    points: {
                      decrement: pointsSpent,
                    },
                    records: {
                      create: {
                        change: -pointsSpent,
                        reason: "REWARDS",
                      },
                    },
                  },
                })
              } catch (error) {
                // P2025 is "no row matched", which here is either no loyalty
                // record or not enough points in it. The customer is told the
                // same thing either way.
                if (
                  error instanceof Prisma.PrismaClientKnownRequestError &&
                  error.code === "P2025"
                ) {
                  throw new Error("INSUFFICIENT_LOYALTY_POINTS")
                }

                throw error
              }
            }

            return writeCartItem(tx)
          }, TRANSACTION_OPTIONS),
        )
      : await retryOnCartConflict(() => writeCartItem(db))

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
    // Carries its own status and wording. Reported as "Internal server error" until
    // now, which told a customer the shop was broken when the offer had simply run out.
    if (error instanceof OfferUnavailableError) {
      res.status(error.status).json({ message: error.message })
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
              // lapsed membership) from one anybody may hold, and to tell
              // whether the offer behind it still stands at all.
              offer: {
                select: {
                  audience: true,
                  isActive: true,
                  startsAt: true,
                  endsAt: true,
                  archivedAt: true,
                },
              },
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
              data: RELEASE_REDEMPTION,
            }),
          ),
      ])

      await db.cart.delete({ where: { id: cart.id } })
      res.status(200).json({ success: true, message: "Cart expired" })
      return
    }

    let warning: string | null = null

    if (cart) {
      const now = new Date()

      // A lapsed membership only invalidates the members-only offers. An offer
      // open to everyone (or to new customers) is still perfectly valid, so it
      // must survive — this used to delete every offer item indiscriminately,
      // which would strip a non-member's legitimate item on every cart load.
      const memberOnlyItems = !membership?.isActive
        ? cart.cartItems.filter(
            (item) => item.offerId && item.offer?.audience === "MEMBERS",
          )
        : []

      // The other way a held offer item stops standing: the offer ended, was
      // archived, or was switched off while the item sat in the cart. Nothing
      // swept these, so the cart kept the offer price for as long as it lived —
      // all the way through the payment intent and into the order, because
      // `calculateCartPrice` reads the discount stored on the row and never asks
      // the offer whether it is still running. Closing a run in the admin left
      // every cart already holding the offer able to buy at its price.
      const retiredOfferItems = cart.cartItems.filter(
        (item) => item.offerId && item.offer && !isOfferLive(item.offer, now),
      )

      // One item can qualify both ways; deleting it twice would be harmless but
      // releasing its redemption twice would hand back a use it never had.
      const doomed = [...new Set([...memberOnlyItems, ...retiredOfferItems])]

      if (doomed.length > 0) {
        // Releases and the delete hit different tables, so they go together.
        const [, deletedItems] = await Promise.all([
          Promise.all(
            doomed.map((item) =>
              db.offerRedemption.updateMany({
                where: { offerId: item.offerId!, userId, used: { gt: 0 } },
                data: RELEASE_REDEMPTION,
              }),
            ),
          ),
          db.cartItem.deleteMany({
            where: { id: { in: doomed.map((item) => item.id) } },
          }),
        ])

        if (deletedItems.count > 0) {
          warning =
            memberOnlyItems.length > 0 && retiredOfferItems.length > 0
              ? "Some items in your cart are no longer available. They have been removed from your cart."
              : memberOnlyItems.length > 0
                ? "One or more items in your cart requires an active membership. These items have been removed from your cart."
                : "One or more offers in your cart is no longer available. Those items have been removed from your cart."
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

    await retryOnCartConflict(() =>
      db.$transaction(async (tx) => {
        // Redemptions, then points, then the cart - the lock order at the top
        // of this file. The first two used to be the other way round, which
        // put clearing a cart at odds with adding to one.
        //
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
            data: RELEASE_REDEMPTION,
          })
        }

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

        await tx.cart.delete({ where: { userId } })
      }, TRANSACTION_OPTIONS),
    )

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

    await retryOnCartConflict(() =>
      db.$transaction(async (tx) => {
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
            data: RELEASE_REDEMPTION,
          })
        }

        // Refunded before the cart is touched, to keep the lock order above.
        // This ran after the cart update until it began deadlocking against
        // adds, which take these same two rows the other way round.
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

        // delete cart if empty

        if (updatedCart.cartItems.length === 0) {
          await tx.cart.delete({
            where: { id: updatedCart.id },
          })
        }

        return cartItem.id
      }, TRANSACTION_OPTIONS),
    )

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

    const [dessert, existingCartItem, membership, customisationRows] =
      await Promise.all([
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
            // The offer this line actually holds. Pricing used to read the
            // offer id out of the request, which never gets written to the
            // row - so quoting a generous offer's id while editing a plain
            // item applied that offer's discount without ever holding a
            // redemption against it.
            offerId: true,
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
        loadCustomisations(cartItem.customisations),
      ])

    if (!dessert) {
      res.status(404).json({ message: "Dessert not found" })
      return
    }

    if (!existingCartItem) {
      res.status(404).json({ message: "Cart item not found" })
      return
    }

    const customisations = resolveCustomisations(
      cartItem.customisations,
      customisationRows,
    )

    if (!customisations) {
      res.status(400).json({ message: "Unknown customisation" })
      return
    }

    // Whether a line was paid for in points is fixed when it is created,
    // because that is the only moment anything is debited. Letting an edit
    // introduce or drop the points would grant or destroy a redemption for
    // nothing. The app always resends the line's existing value, so no edit a
    // customer can actually make is refused here.
    const storedPoints = existingCartItem.loyaltyPointsUsed ?? 0

    if ((cartItem.loyaltyPointsUsed ?? 0) !== storedPoints) {
      res.status(400).json({
        message: "Remove the item and add it again to change how it is paid for",
      })
      return
    }

    // Priced from the dessert and from the database's own customisation names.
    // The add-back/remove bookkeeping the old code did is gone with the price
    // it was adjusting: there is nothing to correct when the figure is worked
    // out from scratch on every edit.
    const isRedemption = storedPoints > 0
    const listPriceInCents = isRedemption ? 0 : dessert.priceInCents

    const itemPriceInCentsBeforeDiscount = Math.max(
      0,
      listPriceInCents -
        mochiAdjustmentInCents(customisations, dessert.category.name),
    )

    const maxMembershipDiscount = Math.min(
      membership?.plan.maxDiscount ?? 0,
      (membership?.totalMonths ?? 1) *
        (membership?.plan.membershipDiscount ?? 0),
    )

    let finalDiscountedAmount = 0

    if (existingCartItem.offerId) {
      const offer = await db.offer.findUnique({
        where: { id: existingCartItem.offerId },
        include: { dessert: true },
      })
      // Same liveness check as addItemToCart: editing a line must not reprice it
      // against an offer that has since been paused, archived or run out.
      if (!offer || !isOfferLive(offer)) {
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

      finalDiscountedAmount = Math.max(
        0,
        itemPriceInCentsBeforeDiscount - offerUnitPriceInCents(offer, dessert),
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

    const newCustomisationPrice = customisations.reduce(
      (sum, customisation) =>
        sum +
        (customisation.quantity > 0
          ? (customisation.priceInCents -
              customisationDiscount(
                customisation,
                membership,
                maxMembershipDiscount,
              )) *
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

    await db.cart.update({
      where: { userId },
      data: {
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000), // extend expiry
        totalPriceInCents: { increment: priceDifference },
        cartItems: {
          update: {
            where: { id: cartItem.id },
            data: {
              itemPriceInCents: itemPriceInCentsBeforeDiscount, // get price from order item
              discountedAmountInCents: Math.round(finalDiscountedAmount),
              // Unchanged by construction - the guard above refuses an edit
              // that would move it - but written explicitly so the row cannot
              // drift from what was actually debited.
              loyaltyPointsUsed: existingCartItem.loyaltyPointsUsed,
              // quantity: cartItem.quantity,
              customisations: {
                deleteMany: {},
                create: customisations.map((customisation) => ({
                  customisation: { connect: { id: customisation.id } },
                  discountedAmountInCents: customisationDiscount(
                    customisation,
                    membership,
                    maxMembershipDiscount,
                  ),
                  quantity: customisation.quantity,
                })),
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

    // An offer holds a redemption, and a reward has already been paid for in
    // points. Both are recorded once, when the line is created, so multiplying
    // the line here would multiply the item without multiplying what it cost.
    //
    // This is how rewards were being given away: adding a reward already in the
    // cart merged into the existing line and came through here, and nothing on
    // this path debits points — `addItemToCart` is the only thing that does. A
    // second reward is a second add, which debits again.
    if (cartItem.offerId) {
      res
        .status(400)
        .json({ message: "Cannot change the quantity of an offer item" })
      return
    }

    if (cartItem.loyaltyPointsUsed) {
      res
        .status(400)
        .json({ message: "Cannot change the quantity of a reward item" })
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
        // No points term. This used to re-add the line's points on every
        // quantity change, including a decrement, which drifted the column.
        // The guard above means a line reaching here never has any.
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
