import * as SecureStore from "expo-secure-store"
import { jwtDecode } from "jwt-decode"

type JWTData = {
  userId: string // or whatever your JWT payload contains
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
    const token = await SecureStore.getItemAsync("token")
    if (!token) {
    }
    await SecureStore.deleteItemAsync("token")
  } catch (error) {
    console.error("Error removing token from SecureStore:", error)
    return null
  }
}
