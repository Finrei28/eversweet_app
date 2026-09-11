import { Request, Response } from "express"
import { Prisma } from "@prisma/client"
import { db } from "../lib/db"
import { getErrorMessage } from "../utils/getError"
import { nzMonthRange } from "../lib/tradingHours"
import {
  formatPrizeCode,
  generatePrizeCode,
  looksLikePrizeCode,
  normalisePrizeCode,
} from "../lib/prizeCode"
import { sendPushToUser } from "../lib/pushToUser"
import { settleMonthlyWinners } from "./client.controller"

/**
 * How long a prize stays collectable: to the end of the month after the one it
 * was won in. Won in September, collectable through October, gone at NZ
 * midnight on 1 November.
 *
 * Derived from the month that was *won*, never from when staff got round to
 * assigning it, so a reward entered late does not quietly extend the deadline.
 */
const expiryFor = (month: number, year: number) => {
  // A day safely inside the won month, then two month-steps forward: one to the
  // collection month, one to its end. Built through nzMonthRange so the instant
  // is NZ midnight rather than the UTC host's.
  const insideWonMonth = new Date(Date.UTC(year, month - 1, 15, 12))
  return nzMonthRange(insideWonMonth, 1).end
}

/** Staff need the real name to hand a prize over, whatever the customer chose
 * for the public board. The public surfaces redact; this one deliberately does
 * not, which is the same asymmetry getLoyaltyWinner already relies on. */
const winnerSelect = {
  id: true,
  place: true,
  month: true,
  year: true,
  points: true,
  userId: true,
  user: { select: { firstName: true, lastName: true } },
  reward: true,
} satisfies Prisma.LoyaltyWinnerSelect

type WinnerRow = Prisma.LoyaltyWinnerGetPayload<{ select: typeof winnerSelect }>

const serialiseForAdmin = (winner: WinnerRow) => ({
  id: winner.id,
  place: winner.place,
  month: winner.month,
  year: winner.year,
  points: winner.points,
  /** Null once the account is closed — the prize is then uncollectable. */
  userId: winner.userId,
  firstName: winner.user?.firstName ?? null,
  lastName: winner.user?.lastName ?? null,
  accountClosed: winner.userId === null,
  reward: winner.reward
    ? {
        id: winner.reward.id,
        title: winner.reward.title,
        description: winner.reward.description,
        code: formatPrizeCode(winner.reward.code),
        expiresAt: winner.reward.expiresAt,
        redeemedAt: winner.reward.redeemedAt,
        expired:
          winner.reward.redeemedAt === null &&
          winner.reward.expiresAt <= new Date(),
      }
    : null,
})

/**
 * The podium for a month, for staff. Defaults to the month that just ended,
 * which is the one with prizes still to give out.
 */
export const getMonthlyWinners = async (req: Request, res: Response) => {
  try {
    const requested = {
      month: Number(req.query.month),
      year: Number(req.query.year),
    }
    const useRequested =
      Number.isInteger(requested.month) &&
      requested.month >= 1 &&
      requested.month <= 12 &&
      Number.isInteger(requested.year) &&
      requested.year >= 2000

    const { month, year } = useRequested
      ? requested
      : nzMonthRange(new Date(), -1)

    const winners = await db.loyaltyWinner.findMany({
      where: { month, year },
      select: winnerSelect,
      orderBy: { place: "asc" },
    })

    res.status(200).json({
      month,
      year,
      winners: winners.map(serialiseForAdmin),
    })
  } catch (error) {
    console.error("Failed to get monthly winners:", error)
    res.status(500).json({ message: "Failed to get monthly winners" })
  }
}

/**
 * Sets or edits what a winner is owed, minting their code the first time.
 *
 * The code is minted once and never rotated on an edit: a customer may already
 * be holding a screenshot of it, and reissuing would strand them at the counter
 * with a code that no longer exists. Editing the wording of a prize is a
 * different thing from replacing it.
 */
export const assignWinnerReward = async (req: Request, res: Response) => {
  try {
    const adminId = (req as Request & { userId?: string }).userId ?? null
    const { winnerId, title, description } = req.body ?? {}

    if (typeof winnerId !== "string" || !winnerId) {
      res.status(400).json({ message: "winnerId is required" })
      return
    }
    if (typeof title !== "string" || !title.trim()) {
      res.status(400).json({ message: "A reward title is required" })
      return
    }
    if (description != null && typeof description !== "string") {
      res.status(400).json({ message: "description must be text" })
      return
    }

    const winner = await db.loyaltyWinner.findUnique({
      where: { id: winnerId },
      select: winnerSelect,
    })

    if (!winner) {
      res.status(404).json({ message: "That winner does not exist" })
      return
    }

    // Already handed over. Editing the wording now would rewrite what the shop
    // gave someone after the fact, and the customer's own record of it too.
    if (winner.reward?.redeemedAt) {
      res.status(409).json({
        message: "This prize has already been collected and cannot be changed",
      })
      return
    }

    if (winner.userId === null) {
      res.status(409).json({
        message: "This account has been closed, so the prize cannot be claimed",
      })
      return
    }

    const cleanTitle = title.trim()
    const cleanDescription = description?.trim() || null

    if (winner.reward) {
      const reward = await db.winnerReward.update({
        where: { id: winner.reward.id },
        data: { title: cleanTitle, description: cleanDescription },
      })
      // No push on an edit: the customer has already been told, and a second
      // ping for a reworded title reads as a second prize.
      res.status(200).json({
        reward: { ...reward, code: formatPrizeCode(reward.code) },
        notified: false,
      })
      return
    }

    const expiresAt = expiryFor(winner.month, winner.year)
    const reward = await createRewardWithCode({
      winnerId: winner.id,
      title: cleanTitle,
      description: cleanDescription,
      expiresAt,
      adminId,
    })

    // After the write, and never allowed to fail it — see sendPushToUser.
    const notified = await sendPushToUser(
      winner.userId,
      "You won a prize!",
      `You placed ${ordinal(winner.place)} on last month's leaderboard. Tap to see what you have won.`,
      { type: "PRIZE_READY", prizeId: winner.id },
    )

    res.status(201).json({
      reward: { ...reward, code: formatPrizeCode(reward.code) },
      notified,
    })
  } catch (error) {
    console.error("Failed to assign a reward:", error)
    res
      .status(500)
      .json({ message: "Failed to assign the reward: " + getErrorMessage(error) })
  }
}

/**
 * Codes are unique, so a collision is a failed insert rather than a bad code.
 * At 30^8 across a handful of prizes a month this should never fire once, but
 * retrying is three lines and the alternative is an admin seeing a 500.
 */
const createRewardWithCode = async (input: {
  winnerId: string
  title: string
  description: string | null
  expiresAt: Date
  adminId: string | null
}) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await db.winnerReward.create({
        data: {
          winnerId: input.winnerId,
          title: input.title,
          description: input.description,
          code: generatePrizeCode(),
          expiresAt: input.expiresAt,
          assignedByAdminId: input.adminId,
        },
      })
    } catch (error) {
      const isCodeCollision =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        (error.meta?.target as string[] | undefined)?.includes("code")

      if (!isCodeCollision) throw error
    }
  }
  throw new Error("Could not mint a unique prize code")
}

/** How long a collected prize stays on the customer's offers page afterwards. */
const COLLECTED_VISIBLE_MS = 7 * 24 * 60 * 60 * 1000

const ordinal = (place: number) =>
  place === 1 ? "1st" : place === 2 ? "2nd" : place === 3 ? "3rd" : `${place}th`

/** Why a code cannot be collected, in the words staff need to hear. */
type Refusal = "NOT_FOUND" | "ALREADY_REDEEMED" | "EXPIRED"

const refusalMessage = (
  reason: Refusal,
  reward?: { redeemedAt: Date | null; expiresAt: Date },
) => {
  switch (reason) {
    case "ALREADY_REDEEMED":
      // Never "invalid". Read as a typo, staff retype it, and the second time
      // it looks like a fresh code — which is how a prize gets handed out twice.
      return `This prize was already collected on ${reward?.redeemedAt?.toLocaleString("en-NZ", { timeZone: "Pacific/Auckland" })}.`
    case "EXPIRED":
      return `This prize expired on ${reward?.expiresAt.toLocaleDateString("en-NZ", { timeZone: "Pacific/Auckland" })}.`
    default:
      return "That code does not match a prize."
  }
}

const findByCode = async (raw: unknown) => {
  if (typeof raw !== "string" || !raw.trim()) return { bad: true as const }

  const code = normalisePrizeCode(raw)
  // Answer an obviously malformed code without spending a round trip on it.
  if (!looksLikePrizeCode(code)) return { bad: true as const }

  const reward = await db.winnerReward.findUnique({
    where: { code },
    include: { winner: { select: winnerSelect } },
  })

  return { bad: false as const, code, reward }
}

/**
 * Reads a code without spending it, so staff can see who is standing there and
 * what the shop owes them before anything is committed.
 *
 * Splitting this from the redeem is the point: a single endpoint that validated
 * and committed at once would mean a mistyped code that happens to land on
 * someone else's prize is spent before anyone has read the screen.
 */
export const verifyPrizeCode = async (req: Request, res: Response) => {
  try {
    const found = await findByCode(req.query.code)

    if (found.bad || !found.reward) {
      res
        .status(404)
        .json({ valid: false, reason: "NOT_FOUND", message: refusalMessage("NOT_FOUND") })
      return
    }

    const { reward } = found
    const reason: Refusal | null = reward.redeemedAt
      ? "ALREADY_REDEEMED"
      : reward.expiresAt <= new Date()
        ? "EXPIRED"
        : null

    res.status(200).json({
      valid: reason === null,
      reason,
      message: reason ? refusalMessage(reason, reward) : null,
      winner: serialiseForAdmin(reward.winner),
    })
  } catch (error) {
    console.error("Failed to verify a prize code:", error)
    res.status(500).json({ message: "Failed to check that code" })
  }
}

/**
 * Marks a prize collected.
 *
 * One conditional write does the whole job. The `where` repeats every
 * precondition, so two tablets racing the same code cannot both win it: one
 * updates a row, the other updates nothing and is told why. This is the same
 * claim-by-updateMany the password reset uses to spend its token exactly once,
 * and it needs no transaction.
 */
export const redeemPrizeCode = async (req: Request, res: Response) => {
  try {
    const adminId = (req as Request & { userId?: string }).userId ?? null
    const found = await findByCode(req.body?.code)

    if (found.bad || !found.reward) {
      res
        .status(404)
        .json({ redeemed: false, reason: "NOT_FOUND", message: refusalMessage("NOT_FOUND") })
      return
    }

    const now = new Date()
    const claimed = await db.winnerReward.updateMany({
      where: { code: found.code, redeemedAt: null, expiresAt: { gt: now } },
      data: { redeemedAt: now, redeemedByAdminId: adminId },
    })

    if (claimed.count === 0) {
      // Only on the failure path, and only to tell staff which of the two it
      // was. Re-read rather than trusting the row from before the write, which
      // is what a racing tablet would have made stale.
      const current = await db.winnerReward.findUnique({
        where: { code: found.code },
        select: { redeemedAt: true, expiresAt: true },
      })

      const reason: Refusal = current?.redeemedAt
        ? "ALREADY_REDEEMED"
        : "EXPIRED"

      res.status(409).json({
        redeemed: false,
        reason,
        message: refusalMessage(reason, current ?? undefined),
      })
      return
    }

    res.status(200).json({
      redeemed: true,
      redeemedAt: now,
      winner: serialiseForAdmin(found.reward.winner),
    })
  } catch (error) {
    console.error("Failed to redeem a prize code:", error)
    res.status(500).json({ message: "Failed to collect that prize" })
  }
}

/**
 * Settles a month the cron missed — an outage or a deploy across NZ midnight on
 * the 1st, which would otherwise lose that month's podium permanently, since
 * nothing else ever writes one.
 */
export const settleMonth = async (req: Request, res: Response) => {
  try {
    const { month, year } = req.body ?? {}

    if (!Number.isInteger(month) || month < 1 || month > 12) {
      res.status(400).json({ message: "A month from 1 to 12 is required" })
      return
    }
    if (!Number.isInteger(year) || year < 2000) {
      res.status(400).json({ message: "A valid year is required" })
      return
    }

    const current = nzMonthRange(new Date())
    const requestedIndex = year * 12 + (month - 1)
    const currentIndex = current.year * 12 + (current.month - 1)

    if (requestedIndex >= currentIndex) {
      res
        .status(400)
        .json({ message: "That month has not finished yet" })
      return
    }

    // settleMonthlyWinners counts backwards from now, and skipDuplicates makes
    // running it again a no-op, so a month settled twice writes nothing.
    const result = await settleMonthlyWinners(requestedIndex - currentIndex)

    res.status(200).json(result)
  } catch (error) {
    console.error("Failed to settle a month:", error)
    res.status(500).json({ message: "Failed to settle that month" })
  }
}

/**
 * A customer's own prizes.
 *
 * The code is only sent while it would actually be honoured. An expired or
 * already-collected prize comes back without one, so the app is never able to
 * put a code on screen that the counter is going to refuse — the customer finds
 * out on their own phone rather than at the front of a queue.
 *
 * Expired prizes drop out entirely. Recently collected ones stay briefly, so
 * "you collected this" is visible for a while rather than the card just
 * vanishing the moment staff hit confirm.
 */
export const getMyPrizes = async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId?: string }).userId
    if (!userId) {
      res.status(401).json({ message: "Unauthorised" })
      return
    }

    const now = new Date()
    const collectedCutoff = new Date(now.getTime() - COLLECTED_VISIBLE_MS)

    const winners = await db.loyaltyWinner.findMany({
      where: {
        userId,
        OR: [
          // Won, but staff have not said what the prize is yet. Worth showing:
          // "you placed 2nd" is news on its own, and it is the state a customer
          // is in for however long it takes the shop to decide.
          { reward: { is: null } },
          { reward: { redeemedAt: null, expiresAt: { gt: now } } },
          { reward: { redeemedAt: { gt: collectedCutoff } } },
        ],
      },
      select: winnerSelect,
      orderBy: [{ year: "desc" }, { month: "desc" }],
    })

    // A podium that was never given a prize is not worth showing forever, and
    // after the collection window closes there is nothing the customer can do
    // about it.
    const visible = winners.filter(
      (winner) =>
        winner.reward !== null ||
        expiryFor(winner.month, winner.year) > now,
    )

    res.status(200).json({
      prizes: visible.map((winner) => ({
        id: winner.id,
        place: winner.place,
        month: winner.month,
        year: winner.year,
        points: winner.points,
        reward: winner.reward
          ? {
              title: winner.reward.title,
              description: winner.reward.description,
              expiresAt: winner.reward.expiresAt,
              redeemedAt: winner.reward.redeemedAt,
              code:
                winner.reward.redeemedAt === null &&
                winner.reward.expiresAt > now
                  ? formatPrizeCode(winner.reward.code)
                  : null,
            }
          : null,
      })),
    })
  } catch (error) {
    console.error("Failed to get prizes:", error)
    res.status(500).json({ message: "Failed to get your prizes" })
  }
}
