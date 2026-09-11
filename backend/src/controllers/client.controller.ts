import { Request, Response } from "express"
import { db } from "../lib/db"
import ResetPasswordEmail from "../email/ResetPasswordEmail"
import bcrypt from "bcrypt"
import crypto from "crypto"
import { storeHours, storeInfo } from "../lib/storeInfo"
import { quoteMinutes } from "../lib/orderTiming"
import { getPrepTimes } from "../lib/prepTimes"
import { loyaltyRates } from "../lib/loyaltyRates"
import { announcements } from "../lib/announcements"
import { privacyPolicy } from "../legal/privacy-policy"
import { termAndConditions } from "../legal/term-and-conditions"
import VerifyEmail from "../email/verifyEmail"
import emailSender from "../lib/emailSender"
import { organiseLeaderboardDetails } from "../lib/leaderboardDetails"
import { isOfferLive } from "../lib/offerAvailability"
import { getErrorMessage } from "../utils/getError"
import { cached, CACHE_KEYS, invalidate } from "../lib/cache"
import { forgetSession } from "../lib/sessionCache"
import { nzMonthRange } from "../lib/tradingHours"
import { Prisma } from "@prisma/client"

/*
 * Where an admin endpoint exists to make one of these wrong it calls
 * `invalidate` directly, and the TTL is only a backstop. The menu is the
 * exception: nothing in this API edits desserts, categories, offers or prices —
 * those changes are made against the database out of band — so for the menu the
 * TTL *is* the mechanism, and it is kept short enough that a price change is
 * live within a couple of minutes.
 */
const MENU_TTL_SECONDS = 120
const OFFERS_TTL_SECONDS = 120
const DAYS_OFF_TTL_SECONDS = 300
const LEADERBOARD_TTL_SECONDS = 300
const CUSTOMISATIONS_TTL_SECONDS = 300
/** Short: the kitchen flips this to pause dine-in and expects it to take effect. */
const RESTAURANT_STATUS_TTL_SECONDS = 30

export const getMenu = async (req: Request, res: Response) => {
  try {
    // The largest payload the app fetches and the most static: a deep nested
    // include over categories, desserts and ingredients that every customer
    // triggered on every visit.
    const menu = await cached(CACHE_KEYS.menu, MENU_TTL_SECONDS, async () => {
      const rawMenu = await db.category.findMany({
        include: {
          desserts: {
            where: { isAvailableForPurchase: true },
            orderBy: { priceInCents: "asc" },
            select: {
              id: true,
              name: true,
              chineseName: true,
              priceInCents: true,
              priceInLoyaltyPoints: true,
              imagePath: true,
              ingredients: { include: { ingredient: true } },
              description: true,
              promo: true,
            },
          },
        },
      })

      return rawMenu.map((category) => ({
        ...category,
        desserts: category.desserts.map((dessert) => ({
          ...dessert,
          ingredients: dessert.ingredients.map((i) => i.ingredient),
        })),
      }))
    })

    res.set("Cache-Control", "public, max-age=60")
    res.status(200).json({ menu })
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch menu" })
    return
  }
}

export const getAvailableCustomisations = async (
  req: Request,
  res: Response,
) => {
  try {
    const { id } = req.params

    if (!id) {
      res
        .status(400)
        .json({ message: "Dessert id is required to view customisations" })
      return
    }
    // This request sits between tapping a dessert and seeing the modal, so it
    // is squarely on an interactive path. It used to run two queries in series
    // — fetch the dessert, then its category's ingredients — where the
    // relation lets one do the work.
    const customisations = await cached(
      CACHE_KEYS.customisations(id),
      CUSTOMISATIONS_TTL_SECONDS,
      () =>
        db.ingredient.findMany({
          where: {
            isAvailableForPurchase: true,
            categories: {
              some: { category: { desserts: { some: { id } } } },
            },
          },
          orderBy: { priceInCents: "asc" },
          select: {
            id: true,
            chineseName: true,
            name: true,
            priceInCents: true,
          },
        }),
    )

    if (!customisations) {
      res.status(404).json({ message: "No customisations available" })
      return
    }

    res.set("Cache-Control", "public, max-age=60")
    res.status(200).json({ customisations })
  } catch (error) {
    res.status(500).json({ message: error })
  }
}

// How long the client has to actually set a new password once its OTP has
// been verified.
const RESET_TOKEN_TTL_MS = 10 * 60 * 1000

// Only the hash is stored, so a leaked database row can't be replayed against
// the reset endpoint. The token is 32 random bytes, so a plain digest is
// enough — there's nothing to brute force.
const hashResetToken = (token: string) =>
  crypto.createHash("sha256").update(token).digest("hex")

export const getResetPasswordCode = async (req: Request, res: Response) => {
  // Issues (or re-issues) the password reset code. This is deliberately kept
  // separate from the signup verification code in `otp`, so a code mailed for
  // one flow can never be spent on the other.
  const { email } = req.body ?? {}
  if (typeof email !== "string" || !email) {
    res.status(400).json({ message: "Email is required" })
    return
  }
  const normalisedEmail = email.trim().toLowerCase()
  const existUser = await db.user.findFirst({
    where: { email: normalisedEmail },
  })
  if (!existUser) {
    res.status(200).json({ success: true }) // to prevent email enumeration
    return
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString()
  const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000)
  try {
    await db.user.update({
      where: { id: existUser.id },
      data: {
        passwordResetOtp: otp,
        passwordResetOtpExpiresAt: otpExpiresAt,
      },
    })
    const subject = "Reset your password"

    const react = ResetPasswordEmail({ otp })

    await emailSender(existUser.email, subject, react)
    res.status(200).json({ success: true })
    return
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) })
    return
  }
}

export const verifyResetPasswordCode = async (req: Request, res: Response) => {
  const { verificationCode, email } = req.body ?? {}
  if (typeof verificationCode !== "string" || typeof email !== "string") {
    res
      .status(400)
      .json({ message: "Verification code and email are required" })
    return
  }
  const normalisedEmail = email.trim().toLowerCase()
  try {
    const user = await db.user.findUnique({
      where: { email: normalisedEmail },
      select: {
        id: true,
        passwordResetOtp: true,
        passwordResetOtpExpiresAt: true,
      },
    })
    if (!user) {
      res.status(401).json({ message: "Invalid verification code." })
      return
    }

    if (verificationCode !== user.passwordResetOtp?.toString()) {
      res.status(401).json({ message: "Invalid verification code." })
      return
    }

    if (
      !user.passwordResetOtpExpiresAt ||
      new Date() > new Date(user.passwordResetOtpExpiresAt)
    ) {
      res.status(400).json({ message: "Verification code has expired." })
      return
    }

    // The OTP is spent here, so the client gets a single-use token to carry
    // into resetPassword. The where clause repeats the OTP check so two
    // concurrent requests can't both consume the same code.
    const resetToken = crypto.randomBytes(32).toString("hex")
    const consumed = await db.user.updateMany({
      where: {
        id: user.id,
        passwordResetOtp: verificationCode,
        passwordResetOtpExpiresAt: { gt: new Date() },
      },
      data: {
        passwordResetOtp: null,
        passwordResetOtpExpiresAt: null,
        resetToken: hashResetToken(resetToken),
        resetTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    })
    if (consumed.count === 0) {
      res.status(401).json({ message: "Invalid verification code." })
      return
    }

    res.status(200).json({
      success: true,
      message: "Verification code is valid.",
      resetToken,
    })
    return
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) })
    return
  }
}

export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { resetToken, email, newPassword } = req.body ?? {}
    if (typeof resetToken !== "string" || typeof email !== "string") {
      res.status(400).json({
        message: "Reset token, email and new password are required",
      })
      return
    }
    if (typeof newPassword !== "string" || newPassword.length < 6) {
      res
        .status(400)
        .json({ message: "Password must be at least 6 characters long" })
      return
    }
    const normalisedEmail = email.trim().toLowerCase()

    const hashedPassword = await bcrypt.hash(newPassword, 10)

    // One write claims the token and sets the password together. Splitting
    // them lets a failure in between spend the token while leaving the old
    // password in place, and new codes are capped, so the user would be stuck.
    // A miss covers wrong, already used and expired tokens alike — all of
    // which mean "start the flow again".
    const claimed = await db.user.updateMany({
      where: {
        email: normalisedEmail,
        resetToken: hashResetToken(resetToken),
        resetTokenExpiresAt: { gt: new Date() },
      },
      data: {
        password: hashedPassword,
        resetToken: null,
        resetTokenExpiresAt: null,
        // passwordChangedAt cuts off every JWT issued before this moment — see
        // authenticateToken. Without it a stolen 90 day token would outlive
        // the reset that was meant to shut the attacker out.
        passwordChangedAt: new Date(),
      },
    })
    if (claimed.count === 0) {
      res.status(401).json({
        message: "Reset password session expired, please get a new code",
      })
      return
    }

    // authenticateToken can serve its password-change check from Redis for
    // up to a minute, so clear this user's entry. Without it a reset would
    // leave the JWTs it is meant to revoke working until that entry lapsed.
    const resetUser = await db.user.findUnique({
      where: { email: normalisedEmail },
      select: { id: true },
    })

    if (resetUser) await forgetSession(resetUser.id)
    res
      .status(200)
      .json({ success: true, message: "Password reset successfully" })
  } catch (error) {
    res.status(500).json({ message: "Failed to reset password" })
  }
}

export const getStoreHours = (req: Request, res: Response) => {
  res.status(200).json(storeHours)
  return
}

export const getStoreInfo = (req: Request, res: Response) => {
  res.status(200).json(storeInfo)
  return
}

export const restaurantStatus = async (req: Request, res: Response) => {
  // One row, read on every launch and polled while ordering. Tiny, and the
  // two writes that can change it both invalidate this key, so the TTL is
  // only a backstop.
  const status = await cached(
    CACHE_KEYS.restaurantStatus,
    RESTAURANT_STATUS_TTL_SECONDS,
    async () => {
      const restaurant = await db.restaurantStatus.findFirst()
      if (!restaurant) return null

      return {
        dineInAvailability: restaurant.dineInAvailability,
        unavailableUntil: restaurant.unavailableUntil,
      }
    },
  )

  if (!status) {
    res.status(404).json({ message: "Could not find selected store" })
    return
  }

  res.set("Cache-Control", "public, max-age=15")
  res.status(200).json({ restaurantStatus: status })
  return
}

export const getLoyaltyRates = (req: Request, res: Response) => {
  res.status(200).json(loyaltyRates)
  return
}

export const getLeaderboardDetails = async (req: Request, res: Response) => {
  const leaderboardDetails = await cached(
    CACHE_KEYS.leaderboardDetails,
    LEADERBOARD_TTL_SECONDS,
    organiseLeaderboardDetails,
  )
  res.set("Cache-Control", "public, max-age=60")
  res.status(200).json(leaderboardDetails)
  return
}

export const getAnnouncements = (req: Request, res: Response) => {
  res.status(200).json(announcements)
  return
}

export const showOfferForClient = async (req: Request, res: Response) => {
  try {
    // isActive was missing here, so the public home carousel was advertising
    // deactivated offers. `audience` rides along as a scalar so the carousel
    // can vary its call to action.
    //
    // Only the two flags are asked of the database. The dates are applied below,
    // *after* the cache read, so an offer starts and stops on time rather than
    // whenever the 120s entry happens to have been filled — caching the verdict
    // would freeze `now` for the life of the entry.
    const offers = await cached(
      CACHE_KEYS.clientOffers,
      OFFERS_TTL_SECONDS,
      () =>
        db.offer.findMany({
          where: { isActive: true, archivedAt: null },
          include: {
            dessert: { select: { imagePath: true } },
            category: { select: { desserts: { select: { imagePath: true } } } },
          },
        }),
    )

    // Redis hands back JSON, so the dates arrive as strings on a cache hit and as
    // Date objects on a miss. Normalised here rather than trusted either way.
    const now = new Date()
    const live = offers.filter((offer) =>
      isOfferLive(
        {
          isActive: offer.isActive,
          startsAt: offer.startsAt === null ? null : new Date(offer.startsAt),
          endsAt: offer.endsAt === null ? null : new Date(offer.endsAt),
          archivedAt:
            offer.archivedAt === null ? null : new Date(offer.archivedAt),
        },
        now,
      ),
    )

    res.set("Cache-Control", "public, max-age=60")
    res.status(200).json({ offers: live })
    return
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch offers" })
    return
  }
}

export const getPrivacyPolicy = (req: Request, res: Response) => {
  res.status(200).json(privacyPolicy)
  return
}

export const getTermAndConditions = (req: Request, res: Response) => {
  res.status(200).json(termAndConditions)
  return
}

export const getDaysOff = async (req: Request, res: Response) => {
  try {
    const dates = await cached(CACHE_KEYS.daysOff, DAYS_OFF_TTL_SECONDS, async () => {
      const daysOff = await db.daysOff.findMany({ select: { date: true } })
      return daysOff.map((day) => day.date)
    })

    res.set("Cache-Control", "public, max-age=60")
    res.status(200).json({ dates })
    return
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: "Failed to fetch days off" })
    return
  }
}

export const getLoyaltyWinner = async (req: Request, res: Response) => {
  try {
    // The month that just ended — the same one settleMonthlyWinners writes.
    //
    // This used to read `now.getMonth()`, which is 0-indexed, against months the
    // cron stores 1-indexed. It looked right for eleven months of the year by
    // coincidence: 0-indexed September (8) matches stored August (8). In January
    // `getMonth()` is 0, no row can ever carry month 0, and the admin dashboard
    // showed no winner for the whole month — while December's lookup also asked
    // for the wrong year.
    const { month, year } = nzMonthRange(new Date(), -1)

    // Place 1. Kept so admin builds already installed on the shop's tablets keep
    // working after the podium landed; getMonthlyWinners is what the new screen
    // calls.
    const winner = await db.loyaltyWinner.findUnique({
      where: {
        month_year_place: { month, year, place: 1 },
      },
      select: {
        userId: true,
        user: { select: { firstName: true, lastName: true } },
      },
    })

    const winnerDetails = {
      userId: winner?.userId ?? null,
      firstName: winner?.user?.firstName ?? null,
      lastName: winner?.user?.lastName ?? null,
    }
    res.status(200).json({ winnerDetails })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: "Failed to get loyalty winner" })
    return
  }
}

/**
 * The soonest the mobile app may offer a customer.
 *
 * This used to hold its own copy of the timing rule, and the copy was the
 * kitchen's start-now numbers rather than a customer quote — so a single
 * dessert was promised in six minutes, the exact moment the kitchen was told
 * to begin, with no buffer at all. It also disagreed with the website, which
 * quoted ten. Both now come from `quoteMinutes`.
 */
export async function getEstimatedPickUpTime(req: Request, res: Response) {
  const { numOfItems } = req.body ?? {}

  if (typeof numOfItems !== "number" || !Number.isFinite(numOfItems)) {
    res.status(400).json({ message: "numOfItems is required" })
    return
  }

  try {
    const minutes = quoteMinutes(numOfItems, await getPrepTimes())

    res
      .status(200)
      .json({ estimatedTime: new Date(Date.now() + minutes * 60 * 1000) })
    return
  } catch (error) {
    res.status(500).json({
      message: "Failed to estimate a pick up time",
      error: getErrorMessage(error),
    })
    return
  }
}

/** How many of the month's leaderboard are recorded and rewarded. */
export const WINNING_PLACES = 3

/**
 * Records the podium for a finished month.
 *
 * `offset` is in months from now, so the default -1 is "the month that just
 * ended" — what the cron wants, firing at NZ midnight on the 1st. The admin
 * backfill passes an explicit offset for a month the cron missed.
 *
 * Winners are settled once and never revisited. A refund landing in March that
 * would have changed February's ranking does not reopen February; the podium is
 * whatever it was when the month closed.
 */
export async function settleMonthlyWinners(offset = -1) {
  // The bounds have to come from the New Zealand calendar and not the host's:
  // this ran on `new Date(y, m - 1, 1)` under Render's UTC clock, where NZ's
  // 1 September is still 31 August, so it kept settling the month before the one
  // it wanted. See nzMonthRange for the full account.
  const { start, end, month, year } = nzMonthRange(new Date(), offset)

  try {
    const leaderboard = await db.loyaltyRecord.groupBy({
      by: ["loyaltyId"],
      where: {
        // Matches getLeaderBoard exactly. This used to filter on the sign alone,
        // so a refunded redemption — written back as a *positive* record — could
        // crown someone the board never showed in front all month.
        change: { gt: 0 },
        reason: "EARNED",
        createdAt: { gte: start, lt: end },
      },
      _sum: { change: true },
      _max: { createdAt: true },
      orderBy: [
        { _sum: { change: "desc" } },
        // A tie goes to whoever got there first: of two customers level on
        // points, the one whose last qualifying earning came earlier.
        //
        // This used to be a bespoke loop that fetched each tied customer's latest
        // record a query at a time, and it only ever resolved *first* place — a
        // tie for second or third came out in whatever order Postgres happened to
        // emit. Ordering on the aggregate settles every place inside this same
        // query, and getLeaderBoard now orders identically, so the podium
        // customers watched all month is the podium that pays.
        { _max: { createdAt: "asc" } },
        // Last resort, for two customers whose final earning landed in the same
        // millisecond. Arbitrary, but total — without it the order is undefined.
        { loyaltyId: "asc" },
      ],
      take: WINNING_PLACES,
    })

    if (leaderboard.length === 0) {
      return { month, year, recorded: 0 }
    }

    const loyalties = await db.loyalty.findMany({
      where: { id: { in: leaderboard.map((entry) => entry.loyaltyId) } },
      select: { id: true, userId: true },
    })
    const userIdFor = new Map(loyalties.map((l) => [l.id, l.userId]))

    // One statement, so a month cannot half-settle. cron.schedule runs in every
    // process and instances race this; skipDuplicates against the unique on
    // (month, year, place) means the loser writes nothing, rather than throwing a
    // P2002 that then has to be told apart from a real failure.
    const { count } = await db.loyaltyWinner.createMany({
      data: leaderboard.map((entry, index) => ({
        userId: userIdFor.get(entry.loyaltyId) ?? null,
        place: index + 1,
        month,
        year,
        points: entry._sum.change ?? 0,
      })),
      skipDuplicates: true,
    })

    // The banner in the app reads this through a 5 minute cache, so without this
    // the new podium appears minutes after the month turns over.
    await invalidate(CACHE_KEYS.leaderboardDetails)

    return { month, year, recorded: count }
  } catch (error) {
    // Naming the month matters — an unlabelled console.error here is what hid a
    // timezone bug for months, because what it logged looked like noise rather
    // than like "this job settled the wrong month".
    console.error(`Failed to settle the ${month}/${year} podium:`, error)
    return { month, year, recorded: 0 }
  }
}
