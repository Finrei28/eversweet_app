import { Router } from "express"
import { authenticateToken } from "../middleware/authentication"
import {
  cancelMembership,
  checkPaymentStatus,
  createMembership,
  createPaymentIntent,
  createSetupIntent,
  getCurrentSubscriptionPaymentMethodId,
  getMembershipDetails,
  getUsersMembership,
  paymentMethods,
  pollMembershipStatus,
  removeCard,
  resumeMembership,
  retryPayment,
  saveCard,
  setCardForMembershipPayments,
} from "../controllers/stripe.controller"

const router = Router()

router.get("/paymentMethods", authenticateToken, paymentMethods)
router.post("/saveCard", authenticateToken, saveCard)
router.delete("/removeCard", authenticateToken, removeCard)
router.post("/createPaymentIntent", authenticateToken, createPaymentIntent)
router.get("/checkPaymentStatus/:id", authenticateToken, checkPaymentStatus)
router.post("/createMembership", authenticateToken, createMembership)
router.post("/cancelMembership", authenticateToken, cancelMembership)
router.post("/resumeMembership", authenticateToken, resumeMembership)
router.post(
  "/setCardForMembershipPayments",
  authenticateToken,
  setCardForMembershipPayments,
)
router.post("/retryPayment", authenticateToken, retryPayment)
router.get("/pollMembershipStatus", authenticateToken, pollMembershipStatus)
router.get("/getMembershipDetails", authenticateToken, getMembershipDetails)
router.get("/getUsersMembership", authenticateToken, getUsersMembership)
router.post("/createSetupIntent", authenticateToken, createSetupIntent)
router.get(
  "/getCurrentSubscriptionPaymentMethodId",
  authenticateToken,
  getCurrentSubscriptionPaymentMethodId,
)

export default router
