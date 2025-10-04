import { Router } from "express"
import {
  getAvailableCustomisations,
  getMenu,
  getResetPasswordCode,
  verifyResetPasswordCode,
  resetPassword,
  getStoreHours,
  restaurantStatus,
  getLoyaltyRates,
  getPromotions,
} from "../controllers/client.controller"

const router = Router()

router.get("/getMenu", getMenu)
router.get("/getAvailableCustomisations/:id", getAvailableCustomisations)
router.post("/getResetPasswordCode", getResetPasswordCode)
router.post("/verifyResetPasswordCode", verifyResetPasswordCode)
router.post("/resetPassword", resetPassword)
router.get("/getStoreHours", getStoreHours)
router.get("/restaurantStatus", restaurantStatus)
router.get("/getLoyaltyRates", getLoyaltyRates)
router.get("/getPromotions", getPromotions)

export default router
