import { Router } from "express"
import {
  checkVerificationCode,
  createOrder,
  getLeaderBoard,
  getOrder,
  getUser,
  getUserLoyaltyPoints,
  getUserOrders,
  orderStatus,
  showOffers,
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
router.get("/getOrder", authenticateToken, getOrder)
router.post("/getUserOrders", authenticateToken, getUserOrders)
router.post("/createOrder", authenticateToken, createOrder)
router.get("/orderStatus/:id", authenticateToken, orderStatus)
router.get("/showOffers", authenticateToken, showOffers)
router.get("/getLeaderBoard", authenticateToken, getLeaderBoard)

export default router
