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
  signInProvider: (token: string) => Promise<void>
  signOutProvider: () => Promise<void>
  loading: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Load user from localStorage/sessionStorage/etc.
  useEffect(() => {
    const getStoredToken = async () => {
      const storedToken = await SecureStore.getItemAsync("token")
      console.log(storedToken)
      if (storedToken) {
        const decoded: DecodedToken = jwtDecode(storedToken)
        const now = Date.now() / 1000
        if (decoded.exp > now) {
          setToken(storedToken) // ✅ valid
        } else {
          await removeToken() // ❌ expired
          setToken(null)
        }
      }
      setLoading(false)
    }
    getStoredToken()
  }, [])

  const signInProvider = async (token: string) => {
    await SecureStore.setItemAsync("token", token)
    setToken(token)
  }

  const signOutProvider = async () => {
    await removeToken()
    setToken(null)
  }

  return (
    <AuthContext.Provider
      value={{ token, signInProvider, signOutProvider, loading }}
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
