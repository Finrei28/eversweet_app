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
  getLeaderboardDetails,
  getAnnouncements,
  getHomepageCards,
  showOfferForClient,
  getPrivacyPolicy,
  getTermAndConditions,
  getStoreInfo,
  getEstimatedPickUpTime,
} from "../controllers/client.controller"

const router = Router()

router.get("/getMenu", getMenu)
router.get("/getAvailableCustomisations/:id", getAvailableCustomisations)
router.post("/getResetPasswordCode", getResetPasswordCode)
router.post("/verifyResetPasswordCode", verifyResetPasswordCode)
router.post("/resetPassword", resetPassword)
router.get("/getStoreHours", getStoreHours)
router.get("/getStoreInfo", getStoreInfo)
router.get("/restaurantStatus", restaurantStatus)
router.get("/getLoyaltyRates", getLoyaltyRates)
router.get("/getLeaderboardDetails", getLeaderboardDetails)
router.get("/getAnnouncements", getAnnouncements)
router.get("/getHomepageCards", getHomepageCards)
router.get("/showOfferForClient", showOfferForClient)
router.get("/getPrivacyPolicy", getPrivacyPolicy)
router.get("/getTermAndConditions", getTermAndConditions)
router.post("/getEstimatedPickUpTime", getEstimatedPickUpTime)

export default router
