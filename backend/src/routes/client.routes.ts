import { Router } from "express"
import {
  getAvailableCustomisations,
  getMenu,
} from "../controllers/client.controller"

const router = Router()

router.get("/getMenu", getMenu)
router.get("/getAvailableCustomisations", getAvailableCustomisations)

export default router
