import { Router } from "express"
import { authenticateToken } from "../middleware/authentication"
import { authorizeRole } from "../middleware/authorisation"
import {
  adminSignIn,
  updateRestaurantStatus,
  getCurrentOrders,
  getOverview,
  getPastOrders,
  getPendingOrders,
  getPrepTimeSettings,
  updateOrderStatus,
  updatePrepTimeSettings,
  updateDaysOff,
} from "../controllers/admin.controller"
import { getLoyaltyWinner } from "../controllers/client.controller"
import {
  assignWinnerReward,
  getMonthlyWinners,
  redeemPrizeCode,
  settleMonth,
  verifyPrizeCode,
} from "../controllers/prize.controller"
import {
  ipLongLimiter,
  ipShortLimiter,
  prizeCodeDailyLimiter,
  prizeCodeLimiter,
  userNameLongLimiter,
  userNameMediumLimiter,
} from "../middleware/rateLimiter"

const router = Router()

router.post(
  "/signin",
  ipShortLimiter,
  ipLongLimiter,
  userNameMediumLimiter,
  userNameLongLimiter,
  adminSignIn,
)

router.get(
  "/getPendingOrders",
  authenticateToken,
  authorizeRole("ADMIN"),
  getPendingOrders,
)

router.get(
  "/getCurrentOrders",
  authenticateToken,
  authorizeRole("ADMIN"),
  getCurrentOrders,
)
router.post(
  "/getPastOrders",
  authenticateToken,
  authorizeRole("ADMIN"),
  getPastOrders,
)

router.patch(
  "/updateOrderStatus",
  authenticateToken,
  authorizeRole("ADMIN"),
  updateOrderStatus,
)

router.get(
  "/getOverview",
  authenticateToken,
  authorizeRole("ADMIN"),
  getOverview,
)

router.patch(
  "/updateRestaurantStatus",
  authenticateToken,
  authorizeRole("ADMIN"),
  updateRestaurantStatus,
)

router.patch(
  "/updateDaysOff",
  authenticateToken,
  authorizeRole("ADMIN"),
  updateDaysOff,
)
router.get(
  "/getLoyaltyWinner",
  authenticateToken,
  authorizeRole("ADMIN"),
  getLoyaltyWinner,
)

router.get(
  "/getPrepTimes",
  authenticateToken,
  authorizeRole("ADMIN"),
  getPrepTimeSettings,
)

router.patch(
  "/updatePrepTimes",
  authenticateToken,
  authorizeRole("ADMIN"),
  updatePrepTimeSettings,
)

// The month's podium and what each winner is owed. Real names, unlike the public
// banner: staff have to hand the prize to a person.
router.get(
  "/getMonthlyWinners",
  authenticateToken,
  authorizeRole("ADMIN"),
  getMonthlyWinners,
)

router.put(
  "/assignWinnerReward",
  authenticateToken,
  authorizeRole("ADMIN"),
  assignWinnerReward,
)

// The limiters go after authenticateToken, not before: they key on the staff
// account rather than the IP, because every till in the shop shares one egress
// address and an IP-keyed limit would let one counter lock out the others.
//
// verifyPrizeCode reads without committing, which makes it the oracle of the
// two, so it is limited exactly as hard as the write.
router.get(
  "/verifyPrizeCode",
  authenticateToken,
  authorizeRole("ADMIN"),
  prizeCodeLimiter,
  prizeCodeDailyLimiter,
  verifyPrizeCode,
)

router.post(
  "/redeemPrizeCode",
  authenticateToken,
  authorizeRole("ADMIN"),
  prizeCodeLimiter,
  prizeCodeDailyLimiter,
  redeemPrizeCode,
)

// Backfill for a month the cron missed. Nothing else ever writes a podium, so
// without this an outage across NZ midnight on the 1st loses that month for good.
router.post(
  "/settleMonth",
  authenticateToken,
  authorizeRole("ADMIN"),
  settleMonth,
)

export default router
