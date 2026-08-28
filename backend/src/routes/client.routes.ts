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
  getDaysOff,
} from "../controllers/client.controller"
import {
  otpEmailLongLimiter,
  otpEmailMediumLimiter,
  otpIpLongLimiter,
  otpIpShortLimiter,
  verificationEmailLimiter,
} from "../middleware/rateLimiter"

const router = Router()

router.get("/getMenu", getMenu)
router.get("/getAvailableCustomisations/:id", getAvailableCustomisations)
router.post(
  "/getResetPasswordCode",
  otpIpShortLimiter,
  otpIpLongLimiter,
  verificationEmailLimiter,
  getResetPasswordCode,
)
router.post(
  "/verifyResetPasswordCode",
  otpIpShortLimiter,
  otpIpLongLimiter,
  otpEmailMediumLimiter,
  otpEmailLongLimiter,
  verifyResetPasswordCode,
)
router.post(
  "/resetPassword",
  otpIpShortLimiter,
  otpIpLongLimiter,
  otpEmailMediumLimiter,
  otpEmailLongLimiter,
  resetPassword,
)
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
router.get("/getDaysOff", getDaysOff)

export default router
