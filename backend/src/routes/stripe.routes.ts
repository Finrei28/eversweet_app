import { Router } from "express"
import { authenticateToken } from "../middleware/authentication"
import {
  checkPaymentStatus,
  createPaymentIntent,
  paymentMethods,
  removeCard,
  saveCard,
} from "../controllers/stripe.controller"

const router = Router()

router.get("/paymentMethods", authenticateToken, paymentMethods)
router.post("/saveCard", authenticateToken, saveCard)
router.delete("/removeCard", authenticateToken, removeCard)
router.post("/createPaymentIntent", authenticateToken, createPaymentIntent)
router.get("/checkPaymentStatus/:id", authenticateToken, checkPaymentStatus)

export default router
