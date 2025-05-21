import { Router } from "express"
import { authenticateToken } from "../middleware/authentication"
import {
  orderStatusChange,
  pushToken,
  sendNotification,
} from "../controllers/notification.controller"

const router = Router()

router.post("/pushToken", authenticateToken, pushToken)
router.post("/sendNotification", authenticateToken, sendNotification)
router.post("/orderStatusChange", authenticateToken, orderStatusChange)

export default router
