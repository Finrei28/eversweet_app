import { Router } from "express"
import {
  getAvailableCustomisations,
  getMenu,
  getResetPasswordCode,
  verifyResetPasswordCode,
  resetPassword,
  getStoreHours,
  restaurantStatus,
  getLoyaltyRatesForClient,
  getLeaderboardDetails,
  getAnnouncementsForClient,
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
router.get("/getLoyaltyRates", getLoyaltyRatesForClient)
router.get("/getLeaderboardDetails", getLeaderboardDetails)
router.get("/getAnnouncements", getAnnouncementsForClient)
router.get("/showOfferForClient", showOfferForClient)
router.get("/getPrivacyPolicy", getPrivacyPolicy)
router.get("/getTermAndConditions", getTermAndConditions)
router.post("/getEstimatedPickUpTime", getEstimatedPickUpTime)
router.get("/getDaysOff", getDaysOff)

export default router
