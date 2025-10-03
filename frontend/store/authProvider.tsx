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
import { UsersMembership } from "@/utils/types"
import { getUsersMembership } from "@/services/stripe-api"
import { fallbackStoreHours, StoreHours } from "@/lib/businessHours"
import { getStoreHours } from "@/services/api"
import { useLoyaltyStore } from "./points"
import { useCartStore } from "./cart"

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

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [usersMembership, setUsersMembership] =
    useState<UsersMembership | null>(null)
  const [storeHours, setStoreHours] = useState<StoreHours>(fallbackStoreHours)

  // Load user from localStorage/sessionStorage/etc.
  useEffect(() => {
    const getStoredToken = async () => {
      const data = await getStoreHours()
      setStoreHours({ ...fallbackStoreHours, ...data })
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
    await SecureStore.setItemAsync("token", token)
    setToken(token)
    const membership = await getUsersMembership()
    setUsersMembership(membership)
    useLoyaltyStore.getState().fetchPoints() // load fresh points on login
    useCartStore.getState().fetchCart() // load cart items on login
  }

  const signOutProvider = async () => {
    await removeToken()
    setToken(null)
    setUsersMembership(null)
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
