import { Request, Response } from "express"
import { db } from "../lib/db"
import { Resend } from "resend"
import ResetPasswordEmail from "../email/ResetPasswordEmail"
import bcrypt from "bcrypt"
import { storeHours } from "../lib/storeHours"

const resend = new Resend(process.env.RESEND_API_KEY!)

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
  res: Response
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
  const { email } = req.body
  if (!email) {
    res.status(400).json({ message: "Email is required" })
    return
  }
  const existUser = await db.user.findFirst({
    where: { email },
  })
  if (!existUser) {
    res.status(200) // to prevent email enumeration
    return
  }
  const otp = Math.floor(100000 + Math.random() * 900000).toString()
  const otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000)
  try {
    await db.user.update({
      where: { id: existUser.id },
      data: {
        otp,
        otpExpiresAt,
      },
    })
    await resend.emails.send({
      from: '"Eversweet" <eversweet@eversweet.co.nz>',
      to: email,
      subject: "Reset your password",
      react: ResetPasswordEmail({ otp }),
    })
    res.status(200).json({ success: true })
  } catch (error) {
    res.status(500).json({ message: error })
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

export const restaurantStatus = async (req: Request, res: Response) => {
  const restaurantStatus = await db.restaurantStatus.findFirst()
  res
    .status(200)
    .json({ restaurantStatus: restaurantStatus?.dineInAvailability })
  return
}
