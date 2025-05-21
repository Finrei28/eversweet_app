// context/auth-context.tsx
import * as SecureStore from "expo-secure-store"
import React, { createContext, useContext, useEffect, useState } from "react"

type AuthContextType = {
  authenticated: boolean
  setAuthenticated: (value: boolean) => void
  loading: boolean
  signIn: (token: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [authenticated, setAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const checkAuth = async () => {
      const token = await SecureStore.getItemAsync("token")
      setAuthenticated(!!token)
      setLoading(false)
    }

    checkAuth()
  }, [])

  const signIn = async (token: string) => {
    await SecureStore.setItemAsync("token", token)
    setAuthenticated(true)
  }

  const signOut = async () => {
    await SecureStore.deleteItemAsync("token")
    setAuthenticated(false)
  }

  return (
    <AuthContext.Provider
      value={{ authenticated, loading, signIn, signOut, setAuthenticated }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) throw new Error("useAuth must be used within AuthProvider")
  return context
}
