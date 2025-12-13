import * as SecureStore from "expo-secure-store"
import { jwtDecode } from "jwt-decode"

type JWTData = {
  userId: string // or whatever your JWT payload contains
  role: string
  email: string
  exp: number
  iat: number
  // ...any custom claims you use
}

export const getUserIdFromToken = async (): Promise<string | null> => {
  try {
    const token = await SecureStore.getItemAsync("token")
    if (!token) return null

    const decoded: JWTData = jwtDecode(token)
    return decoded.userId
  } catch (error) {
    console.error("Failed to decode token:", error)
    return null
  }
}

export const isUserAuthorised = async (): Promise<boolean> => {
  try {
    const token = await SecureStore.getItemAsync("token")
    if (!token) return false

    const decoded: JWTData = jwtDecode(token)
    const now = Date.now() / 1000
    if (decoded.exp && decoded.exp <= now) {
      return false
    }
    if (decoded.role !== "ADMIN") {
      return false
    }

    return true
  } catch (error) {
    console.error("Failed to decode token:", error.message)
    return false
  }
}

export async function getToken(): Promise<string | null> {
  try {
    const token = await SecureStore.getItemAsync("token")
    return token
  } catch (error) {
    console.error("Error fetching token from SecureStore:", error)
    return null
  }
}

export async function removeToken() {
  try {
    await SecureStore.deleteItemAsync("token")
  } catch (error) {
    console.error("Error removing token from SecureStore:", error)
    return null
  }
}
