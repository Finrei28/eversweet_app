import { Router } from "express"
import {
  getAvailableCustomisations,
  getMenu,
  getResetPasswordCode,
  verifyResetPasswordCode,
  resetPassword,
} from "../controllers/client.controller"

const router = Router()

router.get("/getMenu", getMenu)
router.get("/getAvailableCustomisations", getAvailableCustomisations)
router.post("/getResetPasswordCode", getResetPasswordCode)
router.post("/verifyResetPasswordCode", verifyResetPasswordCode)
router.post("/resetPassword", resetPassword)

export default router
