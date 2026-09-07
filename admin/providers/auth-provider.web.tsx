// TEMPORARY — lets the app bundle for web so a component can be previewed in a
// browser. Delete alongside app/__preview.tsx.
//
// `expo-secure-store` has no web implementation, so the real provider's
// `checkAuth` rejects and `loading` never clears, leaving the app on its
// spinner forever. Metro picks this file for web only; native is untouched.
import React, { createContext, useContext, useState } from "react"

type AuthContextType = {
  authenticated: boolean
  setAuthenticated: (value: boolean) => void
  loading: boolean
  signIn: (token: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

/** Signed out, and finished deciding so — enough to reach a preview route. */
export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [authenticated, setAuthenticated] = useState(false)

  return (
    <AuthContext.Provider
      value={{
        authenticated,
        loading: false,
        setAuthenticated,
        signIn: async () => setAuthenticated(true),
        signOut: async () => setAuthenticated(false),
      }}
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
