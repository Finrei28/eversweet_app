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
  ipLongLimiter,
  ipShortLimiter,
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

export default router
