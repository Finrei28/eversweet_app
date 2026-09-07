import { Router } from "express"

import { announceOrder } from "../controllers/internal.controller"
import { authenticateService } from "../middleware/serviceAuth"
import { serviceLimiter } from "../middleware/rateLimiter"

/**
 * Server-to-server only. Nothing here is reachable with a user token, and
 * nothing here should be called from a browser or an app.
 */
const router = Router()

router.post(
  "/orders/announce",
  serviceLimiter,
  authenticateService,
  announceOrder,
)

export default router
