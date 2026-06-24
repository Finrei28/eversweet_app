import { removeToken } from "@/services/authToken"
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react"
import * as SecureStore from "expo-secure-store"
import { jwtDecode } from "jwt-decode"
import { StoreHours, UsersMembership } from "@/utils/types"
import { getUsersMembership } from "@/services/stripe-api"
import { getStoreHours } from "@/services/api"
import { useLoyaltyStore } from "./points"
import { useCartStore } from "./cart"
import {
  getPushToken,
  registerForPushNotificationsAsync,
  removePushToken,
  savePushToken,
  syncPushToken,
} from "@/services/notifications"

interface DecodedToken {
  userId: string
  email: string
  role: string
  firstName: string
  exp: number
  iat: number
}

interface AuthContextType {
  token: string | null
  usersMembership: UsersMembership | null
  refetchUsersMembership: () => Promise<void>
  signInProvider: (token: string) => Promise<void>
  signOutProvider: () => Promise<void>
  loading: boolean
  storeHours: StoreHours
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const fallbackHours: StoreHours = {
  Monday: ["12:30 PM", "9:30 PM"],
  Tuesday: ["12:30 PM", "9:30 PM"],
  Wednesday: ["12:30 PM", "9:30 PM"],
  Thursday: ["12:30 PM", "9:30 PM"],
  Friday: ["12:00 PM", "10:00 PM"],
  Saturday: ["12:00 PM", "10:00 PM"],
  Sunday: ["12:00 PM", "10:00 PM"],
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [usersMembership, setUsersMembership] =
    useState<UsersMembership | null>(null)
  const [storeHours, setStoreHours] = useState<StoreHours>(fallbackHours)

  // Load user from localStorage/sessionStorage/etc.
  useEffect(() => {
    const getStoredToken = async () => {
      const data = await getStoreHours()
      setStoreHours(data)
      const storedToken = await SecureStore.getItemAsync("token")
      if (storedToken) {
        const decoded: DecodedToken = jwtDecode(storedToken)
        const now = Date.now() / 1000
        if (decoded.exp > now) {
          setToken(storedToken) // ✅ valid
          const membership = await getUsersMembership()
          setUsersMembership(membership)
        } else {
          await removeToken() // ❌ expired
          setToken(null)
          setUsersMembership(null)
        }
      }
      setLoading(false)
    }
    getStoredToken()
  }, [])

  const refetchUsersMembership = async () => {
    if (!token) return
    const membership = await getUsersMembership()
    setUsersMembership(membership)
  }

  const signInProvider = async (token: string) => {
    try {
      await SecureStore.setItemAsync("token", token)
      setToken(token)
      const membership = await getUsersMembership()
      setUsersMembership(membership)
      useLoyaltyStore.getState().fetchPoints() // load fresh points on login
      useCartStore.getState().fetchCart() // load cart items on login
    } catch (error) {
      console.error("Sign in error", error)
      return
    }

    try {
      await syncPushToken()
    } catch (error) {
      console.error("Failed to register push notifications:", error)
    }
  }

  const signOutProvider = async () => {
    try {
      await removeToken()
      await removePushToken()
      setToken(null)
      setUsersMembership(null)
    } catch (error) {
      console.error("Sign out error: ", error)
    }
  }

  return (
    <AuthContext.Provider
      value={{
        token,
        usersMembership,
        refetchUsersMembership,
        signInProvider,
        signOutProvider,
        loading,
        storeHours,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

// Custom hook for easy usage
export const useAuth = () => {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
