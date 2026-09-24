import { Router } from "express"
import { authenticateToken } from "../middleware/authentication"
import {
  getPushToken,
  pushToken,
  removePushToken,
} from "../controllers/notification.controller"

const router = Router()

router.post("/pushToken", authenticateToken, pushToken)
router.get("/getPushToken", authenticateToken, getPushToken)
router.post("/removePushToken", authenticateToken, removePushToken)

export default router
