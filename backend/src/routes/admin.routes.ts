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
  updateOrderStatus,
} from "../controllers/admin.controller"

const router = Router()

router.post("/signin", adminSignIn)

router.get(
  "/getPendingOrders",
  authenticateToken,
  authorizeRole("ADMIN"),
  getPendingOrders
)

router.get(
  "/getCurrentOrders",
  authenticateToken,
  authorizeRole("ADMIN"),
  getCurrentOrders
)
router.post(
  "/getPastOrders",
  authenticateToken,
  authorizeRole("ADMIN"),
  getPastOrders
)

router.patch(
  "/updateOrderStatus",
  authenticateToken,
  authorizeRole("ADMIN"),
  updateOrderStatus
)

router.get(
  "/getOverview",
  authenticateToken,
  authorizeRole("ADMIN"),
  getOverview
)

router.patch(
  "/updateRestaurantStatus",
  authenticateToken,
  authorizeRole("ADMIN"),
  updateRestaurantStatus
)

export default router
