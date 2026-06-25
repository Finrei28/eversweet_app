import { Request, Response } from "express"
import { db } from "../lib/db"
import ResetPasswordEmail from "../email/ResetPasswordEmail"
import bcrypt from "bcrypt"
import { storeHours, storeInfo } from "../lib/storeInfo"
import { loyaltyRates } from "../lib/loyaltyRates"
import { promotions } from "../lib/promotions"
import { announcements } from "../lib/announcements"
import { homepageCards } from "../lib/homePageContent"
import { privacyPolicy } from "../legal/privacy-policy"
import { termAndConditions } from "../legal/term-and-conditions"
import VerifyEmail from "../email/verifyEmail"
import emailSender from "../lib/emailSender"

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

export const getResetPasswordCode = async (req: Request, res: Response) => {
  // this function is used to resend OTP to the user
  const { email } = req.body
  if (!email) {
    res.status(400).json({ message: "Email is required" })
    return
  }
  const normalisedEmail = email.trim().toLowerCase()
  const existUser = await db.user.findFirst({
    where: { email: normalisedEmail },
  })
  if (!existUser) {
    res.status(200) // to prevent email enumeration
    return
  }
  const isEmailVerified = !!existUser.emailVerified
  const otp = Math.floor(100000 + Math.random() * 900000).toString()
  const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000)
  try {
    await db.user.update({
      where: { id: existUser.id },
      data: {
        otp,
        otpExpiresAt,
      },
    })
    const subject = isEmailVerified
      ? "Reset your password"
      : "Verify your email address"
    const react = isEmailVerified
      ? ResetPasswordEmail({ otp })
      : VerifyEmail({ otp })
    await emailSender(existUser.email, subject, react)
    res.status(200).json({ success: true })
    return
  } catch (error) {
    res.status(500).json({ message: (error as Error).message })
    return
  }
}

export const verifyResetPasswordCode = async (req: Request, res: Response) => {
  const { verificationCode, email } = req.body
  try {
    const user = await db.user.findUnique({
      where: { email },
    })
    if (!user) {
      res.status(400).json({ message: "Invalid code" })
      return
    }

    if (verificationCode !== user.otp?.toString()) {
      res.status(401).json({ message: "Invalid verification code." })
      return
    }

    if (!user.otpExpiresAt) {
      res.status(400).json({ message: "Invalid code or code has expired" })
      return
    }

    const currentTime = new Date()
    const expirationTime = new Date(user.otpExpiresAt)

    if (currentTime > expirationTime) {
      res.status(400).json("Verification code has expired.")
      return
    }
    await db.user.update({
      where: { id: user.id },
      data: { otp: null, otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000) },
    })

    res.status(200).json({
      success: true,
      message: "Verification code is valid.",
    })
    return
  } catch (error) {
    res.status(500).json({ message: error })
    return
  }
}

export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { email, newPassword } = req.body
    if (!email || !newPassword) {
      res.status(400).json({ message: "Email and new password are required" })
      return
    }
    const user = await db.user.findUnique({
      where: { email },
    })
    if (!user) {
      res.status(404).json({ message: "User not found" })
      return
    }

    if (!user.otpExpiresAt) {
      res.status(400).json({
        message: "Reset password session expired, please get a new code",
      })
      return
    }

    const currentTime = new Date()
    const expirationTime = new Date(user.otpExpiresAt)

    if (currentTime > expirationTime) {
      res
        .status(400)
        .json("Reset password session expired, please get a new code")
      return
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10)
    await db.user.update({
      where: { email },
      data: { password: hashedPassword },
    })
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
  const restaurantStatus = {
    dineInAvailability: restaurant?.dineInAvailability,
    unavailableUntil: restaurant?.unavailableUntil,
  }
  res.status(200).json({ restaurantStatus })
  return
}

export const getLoyaltyRates = (req: Request, res: Response) => {
  res.status(200).json(loyaltyRates)
  return
}

export const getPromotions = (req: Request, res: Response) => {
  const allOffers = {}
  res.status(200).json(promotions)
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

export function getEstimatedPickUpTime(req: Request, res: Response) {
  const { numOfItems } = req.body
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
