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
  resendVerificationCode,
  showOffers,
  signIn,
  signUp,
  updateAnonymousStatus,
  updateUser,
} from "../controllers/auth.controller"
import { authenticateToken } from "../middleware/authentication"
import {
  userNameMediumLimiter,
  userNameLongLimiter,
  ipLongLimiter,
  ipShortLimiter,
  otpEmailLongLimiter,
  otpEmailMediumLimiter,
  otpIpLongLimiter,
  otpIpShortLimiter,
  verificationEmailLimiter,
} from "../middleware/rateLimiter"

const router = Router()

// No email limiter here: signup 400s on an address that already exists, so it
// can only ever mail a given inbox once. Bulk account creation is the real
// risk, and that's what the IP windows cover.
router.post("/signup", ipShortLimiter, ipLongLimiter, signUp)
router.post(
  "/signin",
  ipShortLimiter,
  ipLongLimiter,
  userNameMediumLimiter,
  userNameLongLimiter,
  signIn,
)
router.post(
  "/resendVerificationCode",
  otpIpShortLimiter,
  otpIpLongLimiter,
  verificationEmailLimiter,
  resendVerificationCode,
)
router.post(
  "/checkVerificationCode",
  otpIpShortLimiter,
  otpIpLongLimiter,
  otpEmailMediumLimiter,
  otpEmailLongLimiter,
  checkVerificationCode,
)
router.get("/getUser", authenticateToken, getUser)
router.patch("/updateUser", authenticateToken, updateUser)
router.get("/getUserLoyaltyPoints", authenticateToken, getUserLoyaltyPoints)
router.get("/getOrder", authenticateToken, getOrder)
router.post("/getUserOrders", authenticateToken, getUserOrders)
router.post("/createOrder", authenticateToken, createOrder)
router.get("/orderStatus/:id", authenticateToken, orderStatus)
router.get("/showOffers", authenticateToken, showOffers)
router.get("/getLeaderBoard", authenticateToken, getLeaderBoard)
router.patch("/updateAnonymousStatus", authenticateToken, updateAnonymousStatus)

export default router
