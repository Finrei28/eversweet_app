import { Router } from "express"

import {
  announceOrder,
  assignRewardForService,
  settleMonthForService,
} from "../controllers/internal.controller"
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

// The website's /admin/winners. Both write through the order server rather than
// the database directly, so prize codes are minted and winners notified in one place.
router.put(
  "/winners/reward",
  serviceLimiter,
  authenticateService,
  assignRewardForService,
)

router.post(
  "/winners/settle",
  serviceLimiter,
  authenticateService,
  settleMonthForService,
)

export default router
