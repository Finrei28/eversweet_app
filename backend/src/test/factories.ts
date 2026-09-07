import { db } from "../lib/db"
import { checkPickUpTime } from "../lib/tradingHours"

let sequence = 0
const unique = () => `${Date.now()}-${++sequence}`

export const makeUser = (overrides: Partial<{ email: string }> = {}) =>
  db.user.create({
    data: {
      email: overrides.email ?? `customer-${unique()}@example.test`,
      password: "hashed-not-used-in-these-tests",
      role: "USER",
      firstName: "Ada",
      lastName: "Lovelace",
      phone: "0211234567",
      emailVerified: new Date(),
    },
  })

export const makeCategory = () =>
  db.category.create({
    data: { name: `Category ${unique()}`, chineseName: "甜品" },
  })

export const makeDessert = async (priceInCents = 1200) => {
  const category = await makeCategory()

  return db.dessert.create({
    data: {
      name: `Mango Sago ${unique()}`,
      chineseName: "芒果西米露",
      priceInCents,
      imagePath: "/desserts/mango-sago.png",
      imagePublicId: `mango-sago-${unique()}`,
      isAvailableForPurchase: true,
      categoryId: category.id,
    },
  })
}

type LineSpec = {
  dessertId: string
  /** List price of one unit, before any discount. */
  itemPriceInCents: number
  quantity?: number
  discountedAmountInCents?: number
}

/**
 * A cart with the lines given. `totalPriceInCents` is set from the lines so
 * the `cart.totalPriceInCents > 0` branch in createOrder behaves as it does in
 * production — the order's own totals are recomputed from the rows regardless.
 */
export const makeCart = async (userId: string, lines: LineSpec[]) => {
  const total = lines.reduce(
    (sum, line) =>
      sum +
      (line.itemPriceInCents - (line.discountedAmountInCents ?? 0)) *
        (line.quantity ?? 1),
    0,
  )

  return db.cart.create({
    data: {
      userId,
      totalPriceInCents: total,
      cartItems: {
        create: lines.map((line) => ({
          dessertId: line.dessertId,
          itemPriceInCents: line.itemPriceInCents,
          discountedAmountInCents: line.discountedAmountInCents ?? 0,
          quantity: line.quantity ?? 1,
        })),
      },
    },
    include: { cartItems: true },
  })
}

/** A user with a single-line cart, which is what most order tests need. */
export const makeCustomerWithCart = async ({
  itemPriceInCents = 1200,
  quantity = 1,
  discountedAmountInCents = 0,
} = {}) => {
  const user = await makeUser()
  const dessert = await makeDessert(itemPriceInCents)
  const cart = await makeCart(user.id, [
    {
      dessertId: dessert.id,
      itemPriceInCents,
      quantity,
      discountedAmountInCents,
    },
  ])

  return { user, dessert, cart }
}

/**
 * The next slot the store will actually accept, found with the same check the
 * endpoint uses. Hard-coding a time would make every order test fail whenever
 * CI happened to run outside trading hours.
 */
export const nextOpenPickUpTime = (eatIn = false): Date => {
  const fifteenMinutes = 15 * 60 * 1000
  let candidate = new Date(Date.now() + 60 * 60 * 1000)

  // A week of quarter-hours is far more than enough to find an open slot.
  for (let step = 0; step < 4 * 24 * 7; step++) {
    if (checkPickUpTime(candidate, { eatIn, daysOffKeys: new Set() }).ok) {
      return candidate
    }
    candidate = new Date(candidate.getTime() + fifteenMinutes)
  }

  throw new Error("No open pick up slot within a week of now")
}
