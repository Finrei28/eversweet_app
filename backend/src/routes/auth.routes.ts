import { Router } from "express"
import {
  addLoyaltyPoints,
  checkVerificationCode,
  createOrder,
  getOrder,
  getUser,
  getUserLoyaltyPoints,
  getUserOrders,
  orderStatus,
  orderWithLoyaltyPoints,
  signIn,
  signUp,
  updateUser,
} from "../controllers/auth.controller"
import { authenticateToken } from "../middleware/authentication"

const router = Router()

router.post("/signup", signUp)
router.post("/signin", signIn)
router.post("/checkVerificationCode", checkVerificationCode)
router.get("/getUser", authenticateToken, getUser)
router.patch("/updateUser", authenticateToken, updateUser)
router.get("/getUserLoyaltyPoints", authenticateToken, getUserLoyaltyPoints)
router.patch("/addLoyaltyPoints", authenticateToken, addLoyaltyPoints)
router.patch(
  "/orderWithLoyaltyPoints",
  authenticateToken,
  orderWithLoyaltyPoints
)
router.get("/getOrder", authenticateToken, getOrder)
router.post("/getUserOrders", authenticateToken, getUserOrders)
router.post("/createOrder", authenticateToken, createOrder)
router.get("/orderStatus/:id", authenticateToken, orderStatus)

export default router
