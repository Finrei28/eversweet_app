import { Router } from "express"
import { authenticateToken } from "../middleware/authentication"
import {
  getPushToken,
  orderStatusChange,
  pushToken,
  removePushToken,
  sendNotification,
} from "../controllers/notification.controller"

const router = Router()

router.post("/pushToken", authenticateToken, pushToken)
router.post("/sendNotification", authenticateToken, sendNotification)
router.post("/orderStatusChange", authenticateToken, orderStatusChange)
router.get("/getPushToken", authenticateToken, getPushToken)
router.post("/removePushToken", authenticateToken, removePushToken)

export default router
