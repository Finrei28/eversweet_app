import { Router } from "express"
import {
  addItemToCart,
  clearCart,
  decrementCartItem,
  getCartItems,
  incrementCartItem,
  removeItemFromCart,
  updateCartItem,
} from "../controllers/cart.controller"
import { authenticateToken } from "../middleware/authentication"

const router = Router()

router.post("/addItemToCart", authenticateToken, addItemToCart)
router.delete("/removeItemFromCart/:id", authenticateToken, removeItemFromCart)
router.delete("/clearCart", authenticateToken, clearCart)
router.patch("/updateCartItem", authenticateToken, updateCartItem)
router.get("/getCartItems", authenticateToken, getCartItems)
router.patch("/incrementCartItem", authenticateToken, incrementCartItem)
router.patch("/decrementCartItem", authenticateToken, decrementCartItem)

export default router
