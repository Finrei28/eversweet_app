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
import {
  LeaderBoardDetails,
  MembershipDetails,
  StoreHours,
  UserDetails,
  UsersMembership,
} from "@/utils/types"
import { getMembershipDetails, getUsersMembership } from "@/services/stripe-api"
import {
  getLeaderboardDetails,
  getStoreHours,
  getUserProfile,
} from "@/services/api"
import { useLoyaltyStore } from "./points"
import { useCartStore } from "./cart"
import { removePushToken, syncPushToken } from "@/services/notifications"

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
  membershipDetails: MembershipDetails | null
  userDetails: UserDetails | null
  leaderboardDetails: LeaderBoardDetails | null
  setUserDetails: React.Dispatch<React.SetStateAction<UserDetails | null>>
  refetchUserDetails: () => Promise<void>
  refetchUsersMembership: () => Promise<void>
  signInProvider: (token: string) => Promise<void>
  signOutProvider: () => Promise<void>
  authLoading: boolean
  dataLoading: boolean
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
  const [userDetails, setUserDetails] = useState<UserDetails | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [dataLoading, setDataLoading] = useState(true)
  const [leaderboardDetails, setLeaderboardDetails] =
    useState<LeaderBoardDetails | null>(null)
  const [usersMembership, setUsersMembership] =
    useState<UsersMembership | null>(null)
  const [membershipDetails, setMembershipDetails] =
    useState<MembershipDetails | null>(null)
  const [storeHours, setStoreHours] = useState<StoreHours>(fallbackHours)

  // Load user from localStorage/sessionStorage/etc.
  useEffect(() => {
    const initialize = async () => {
      try {
        const [storeHours, storedToken] = await Promise.all([
          getStoreHours(),
          SecureStore.getItemAsync("token"),
        ])

        setStoreHours(storeHours)

        if (!storedToken) {
          return
        }

        const decoded = jwtDecode<DecodedToken>(storedToken)

        if (decoded.exp <= Date.now() / 1000) {
          await removeToken()
          return
        }

        setToken(storedToken)
      } catch (error) {
        console.error(error)
      } finally {
        setAuthLoading(false)
      }
    }

    void initialize()
  }, [])

  useEffect(() => {
    if (!token) {
      setUserDetails(null)
      setUsersMembership(null)
      setMembershipDetails(null)
      setLeaderboardDetails(null)
      return
    }

    const loadUserData = async () => {
      try {
        setDataLoading(true)
        const [membership, membershipDetails, user, leaderboardDetails] =
          await Promise.all([
            getUsersMembership(),
            getMembershipDetails(),
            getUserProfile(),
            getLeaderboardDetails(),
          ])
        setLeaderboardDetails(leaderboardDetails)
        setUserDetails(user)
        setMembershipDetails(membershipDetails)
        setUsersMembership(membership)
      } catch (error) {
        console.error(error)
      } finally {
        setDataLoading(false)
      }
    }

    void loadUserData()
  }, [token])

  const refetchUsersMembership = async () => {
    if (!token) return
    try {
      setDataLoading(true)
      const membership = await getUsersMembership()
      setUsersMembership(membership)
    } catch (error) {
      console.error(error)
    } finally {
      setDataLoading(false)
    }
  }

  const refetchUserDetails = async () => {
    if (!token) return
    try {
      setDataLoading(true)
      const user = await getUserProfile()
      setUserDetails(user)
    } catch (error) {
      console.error(error)
    } finally {
      setDataLoading(false)
    }
  }

  const signInProvider = async (token: string) => {
    try {
      await SecureStore.setItemAsync("token", token)
      setToken(token)
      await refetchUsersMembership()
      await refetchUserDetails()
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
      await removePushToken()
      await removeToken()
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
        membershipDetails,
        userDetails,
        leaderboardDetails,
        setUserDetails,
        refetchUserDetails,
        refetchUsersMembership,
        signInProvider,
        signOutProvider,
        authLoading,
        dataLoading,
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
