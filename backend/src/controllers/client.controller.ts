import { Request, Response } from "express"
import { db } from "../lib/db"
import ResetPasswordEmail from "../email/ResetPasswordEmail"
import bcrypt from "bcrypt"
import crypto from "crypto"
import { storeHours, storeInfo } from "../lib/storeInfo"
import { loyaltyRates } from "../lib/loyaltyRates"
import { announcements } from "../lib/announcements"
import { homepageCards } from "../lib/homePageContent"
import { privacyPolicy } from "../legal/privacy-policy"
import { termAndConditions } from "../legal/term-and-conditions"
import VerifyEmail from "../email/verifyEmail"
import emailSender from "../lib/emailSender"
import { organiseLeaderboardDetails } from "../lib/leaderboardDetails"
import { getErrorMessage } from "../utils/getError"

export const getMenu = async (req: Request, res: Response) => {
  try {
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

    if (!rawMenu) {
      res.status(404).json({ message: "No products found" })
      return
    }
    const menu = rawMenu.map((category) => ({
      ...category,
      desserts: category.desserts.map((dessert) => ({
        ...dessert,
        ingredients: dessert.ingredients.map((i) => i.ingredient),
      })),
    }))
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
    const dessert = await db.dessert.findFirst({ where: { id } })
    const customisations = await db.ingredient.findMany({
      where: {
        isAvailableForPurchase: true,
        categories: { some: { categoryId: dessert?.categoryId } },
      },
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
  const restaurant = await db.restaurantStatus.findFirst()
  if (!restaurant) {
    res.status(404).json({ message: "Could not find selected store" })
    return
  }
  const restaurantStatus = {
    dineInAvailability: restaurant.dineInAvailability,
    unavailableUntil: restaurant.unavailableUntil,
  }
  res.status(200).json({ restaurantStatus })
  return
}

export const getLoyaltyRates = (req: Request, res: Response) => {
  res.status(200).json(loyaltyRates)
  return
}

export const getLeaderboardDetails = async (req: Request, res: Response) => {
  const leaderboardDetails = await organiseLeaderboardDetails()
  res.status(200).json(leaderboardDetails)
  return
}

export const getAnnouncements = (req: Request, res: Response) => {
  res.status(200).json(announcements)
  return
}

export const getHomepageCards = (req: Request, res: Response) => {
  res.status(200).json(homepageCards)
  return
}

export const showOfferForClient = async (req: Request, res: Response) => {
  try {
    const offers = await db.offer.findMany({
      include: {
        dessert: { select: { imagePath: true } },
        category: { select: { desserts: { select: { imagePath: true } } } },
      },
    })
    res.status(200).json({ offers })
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
    const daysOff = await db.daysOff.findMany({ select: { date: true } })
    const dates = daysOff.map((day) => day.date)
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
    const now = new Date()
    const month = now.getMonth()
    const year = now.getFullYear()
    const winner = await db.loyaltyWinner.findUnique({
      where: {
        month_year: { month, year },
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

export function getEstimatedPickUpTime(req: Request, res: Response) {
  const { numOfItems } = req.body ?? {}
  if (typeof numOfItems !== "number") {
    res.status(400).json({ message: "numOfItems is required" })
    return
  }
  const fiveMinutes = new Date(Date.now() + 6 * 60 * 1000)
  const tenMinutes = new Date(Date.now() + 11 * 60 * 1000)
  const fifteenMinutes = new Date(Date.now() + 16 * 60 * 1000)
  const twentyMinutes = new Date(Date.now() + 21 * 60 * 1000)

  const minTime =
    numOfItems === 1
      ? fiveMinutes
      : numOfItems <= 3
        ? tenMinutes
        : numOfItems <= 6
          ? fifteenMinutes
          : twentyMinutes

  res.status(200).json({ estimatedTime: minTime })
  return
}

export async function calculateMonthlyWinner() {
  const now = new Date()

  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const end = new Date(now.getFullYear(), now.getMonth(), 1)

  const month = start.getMonth() + 1
  const year = start.getFullYear()
  try {
    const leaderboard = await db.loyaltyRecord.groupBy({
      by: ["loyaltyId"],
      where: {
        change: {
          gt: 0,
        },
        createdAt: {
          gte: start,
          lt: end,
        },
      },
      _sum: {
        change: true,
      },
      orderBy: {
        _sum: {
          change: "desc",
        },
      },
    })

    if (leaderboard.length === 0) {
      return
    }

    const highestPoints = leaderboard[0]._sum.change ?? 0

    const tied = leaderboard.filter(
      (entry) => (entry._sum.change ?? 0) === highestPoints,
    )

    let winnerLoyaltyId: string

    if (tied.length === 1) {
      winnerLoyaltyId = tied[0].loyaltyId
    } else {
      const latestRecords = await Promise.all(
        tied.map(async (entry) => {
          const latestRecord = await db.loyaltyRecord.findFirst({
            where: {
              loyaltyId: entry.loyaltyId,
              change: {
                gt: 0,
              },
              createdAt: {
                gte: start,
                lt: end,
              },
            },
            orderBy: {
              createdAt: "desc",
            },
          })

          return {
            loyaltyId: entry.loyaltyId,
            createdAt: latestRecord!.createdAt,
          }
        }),
      )

      latestRecords.sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      )

      winnerLoyaltyId = latestRecords[0].loyaltyId
    }

    const winner = await db.loyalty.findUnique({
      where: {
        id: winnerLoyaltyId,
      },
    })

    await db.loyaltyWinner.create({
      data: {
        userId: winner ? winner.userId : null,
        month,
        year,
        points: highestPoints,
      },
    })
  } catch (error) {
    console.error(error)
  }
}
