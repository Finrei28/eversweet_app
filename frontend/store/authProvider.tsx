import { getToken, removeToken, saveToken } from "@/services/authToken"
import { setUnauthorizedHandler } from "@/services/apiClient"
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  ReactNode,
} from "react"
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
  getDaysOff,
  getLeaderboardDetails,
  getStoreHours,
  getUserProfile,
} from "@/services/api"
import { DaysOff, toDaysOff, TradingCalendar } from "@/lib/businessHours"
import { useLoyaltyStore } from "./points"
import { useCartStore } from "./cart"
import { queryClient } from "@/services/queryClient"
import { removePushToken, syncPushToken } from "@/services/notifications"
import Toast from "react-native-toast-message"

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
  /** Weekly hours on their own — for display. Use `tradingCalendar` to decide
   * whether the store is actually open, since that also honours days off. */
  storeHours: StoreHours
  tradingCalendar: TradingCalendar
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
  const [daysOff, setDaysOff] = useState<DaysOff>(() => new Set<string>())
  const signingOut = useRef(false)

  // Memoised because checkout keys effects off this value; a fresh object each
  // render would restart the pickup-time lookup in a loop.
  const tradingCalendar = useMemo<TradingCalendar>(
    () => ({ storeHours, daysOff }),
    [storeHours, daysOff],
  )

  useEffect(() => {
    // Everything signOutProvider touches is either a state setter or a module
    // level store, so the first closure stays correct for the app's lifetime.
    setUnauthorizedHandler(() => {
      void signOutProvider()
    })

    return () => setUnauthorizedHandler(null)
  }, [])

  // Load user from localStorage/sessionStorage/etc.
  useEffect(() => {
    // Whether there is a session depends only on the locally stored token.
    // This used to share a Promise.all with the store hours and days off, so
    // authLoading — which gates most of the app — was held behind two network
    // calls that say nothing about being signed in.
    const resolveSession = async () => {
      try {
        const storedToken = await getToken()

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

    // Public data, and nothing waits on it: fallbackHours stands in until it
    // lands, which is the same contract the fallback already had.
    const loadTradingCalendar = async () => {
      const [storeHoursResult, daysOffResult] = await Promise.all([
        getStoreHours().catch((error) => {
          console.error("Failed to fetch store hours:", error)
          return fallbackHours
        }),
        // An empty list on failure keeps the store on its weekly hours
        // rather than shutting ordering down over a dropped request. The
        // order endpoint is the backstop for a day off missed this way.
        getDaysOff().catch((error) => {
          console.error("Failed to fetch days off:", error)
          return [] as Date[]
        }),
      ])

      setStoreHours(storeHoursResult)
      setDaysOff(toDaysOff(daysOffResult))
    }

    void resolveSession()
    void loadTradingCalendar()
  }, [])

  useEffect(() => {
    if (!token) {
      setUserDetails(null)
      setUsersMembership(null)
      setMembershipDetails(null)
      setLeaderboardDetails(null)
      // There is no per-user data to wait for when signed out. Without this the
      // flag stayed true for the whole session and every screen gating on it
      // (home, menu, profile, offers, leaderboard, membership, payment methods)
      // sat on a loader that could never clear.
      setDataLoading(false)
      return
    }

    const loadUserData = async () => {
      try {
        setDataLoading(true)
        const [
          membershipResult,
          membershipDetailsResult,
          userResult,
          leaderboardResult,
        ] = await Promise.allSettled([
          getUsersMembership(),
          getMembershipDetails(),
          getUserProfile(),
          getLeaderboardDetails(),
        ])

        if (membershipResult.status === "fulfilled") {
          setUsersMembership(membershipResult.value)
        } else {
          console.error("Failed to fetch membership:", membershipResult.reason)
        }

        if (membershipDetailsResult.status === "fulfilled") {
          setMembershipDetails(membershipDetailsResult.value)
        } else {
          console.error(
            "Failed to fetch membership details:",
            membershipDetailsResult.reason,
          )
        }

        if (userResult.status === "fulfilled") {
          setUserDetails(userResult.value)
        } else {
          console.error("Failed to fetch user profile:", userResult.reason)
        }

        setLeaderboardDetails(
          leaderboardResult.status === "fulfilled"
            ? leaderboardResult.value
            : { show: true, description: "", lastMonthsWinner: null },
        )
      } catch (error) {
        console.error(error)
      } finally {
        setDataLoading(false)
      }
    }

    void loadUserData()
  }, [token])

  const refetchUsersMembership = useCallback(async () => {
    if (!token) return
    try {
      setDataLoading(true)
      const membership = await getUsersMembership()
      setUsersMembership(membership)
    } catch (error) {
      console.error(error)
      Toast.show({
        type: "error",
        text1: `There was a problem getting your membership details.`,
        position: "bottom",
        visibilityTime: 5000,
        autoHide: true,
        bottomOffset: 90,
      })
    } finally {
      setDataLoading(false)
    }
  }, [token])

  const refetchUserDetails = useCallback(async () => {
    if (!token) return
    try {
      setDataLoading(true)
      const user = await getUserProfile()
      setUserDetails(user)
    } catch (error) {
      console.error(error)
      Toast.show({
        type: "error",
        text1: `There was a problem getting your details.`,
        position: "bottom",
        visibilityTime: 5000,
        autoHide: true,
        bottomOffset: 90,
      })
    } finally {
      setDataLoading(false)
    }
  }, [token])

  const signInProvider = useCallback(async (newToken: string) => {
    try {
      await saveToken(newToken)
      // Setting the token drives the loadUserData effect above, which fetches
      // the membership and profile. Calling the refetch helpers here instead
      // did nothing: they read `token` from this render's closure, which is
      // still null at sign-in time, and returned early.
      setToken(newToken)
      await Promise.all([
        useLoyaltyStore.getState().fetchPoints(), // load fresh points on login
        useCartStore.getState().fetchCart(), // load cart items on login
      ])
    } catch (error) {
      console.error("Sign in error", error)
      return
    }

    try {
      await syncPushToken()
    } catch (error) {
      console.error("Failed to register push notifications:", error)
    }
  }, [])

  const signOutProvider = useCallback(async () => {
    // Re-entrancy guard. signOutProvider calls removePushToken, which is an
    // authenticated request; if that returns 401 it fires the unauthorized
    // handler, which calls signOutProvider again. Without this the two call
    // each other until the stack gives out.
    if (signingOut.current) return
    signingOut.current = true

    try {
      await removePushToken()
      await removeToken()
      setToken(null)
      setUsersMembership(null)
      // These stores live outside React and the points are persisted to
      // AsyncStorage, so without clearing them the next account to sign in on
      // this device starts with the previous user's cart and balance.
      useLoyaltyStore.getState().reset()
      useCartStore.setState({ items: [], cartOperations: 0, error: null })
      // Same hazard, one layer up. Every per-customer query is gated on the
      // token, so signing out disables them — but react-query keeps the data
      // for gcTime, and the next account to sign in re-enables those same keys
      // and paints the previous customer's orders, offers and prizes from cache
      // while the refetch is still in flight. A prize carries a code someone
      // could walk to the counter with, which is what made this worth closing.
      queryClient.clear()
    } catch (error) {
      console.error("Sign out error: ", error)
    } finally {
      signingOut.current = false
    }
  }, [])

  // A fresh object here re-rendered all 21 useAuth consumers on every one of
  // this provider's renders — and a signed-in cold start produces about nine of
  // them. The callbacks above are useCallback'd first; memoising the object
  // while they were recreated each render would have changed nothing.
  const value = useMemo<AuthContextType>(
    () => ({
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
      tradingCalendar,
    }),
    [
      token,
      usersMembership,
      membershipDetails,
      userDetails,
      leaderboardDetails,
      refetchUserDetails,
      refetchUsersMembership,
      signInProvider,
      signOutProvider,
      authLoading,
      dataLoading,
      storeHours,
      tradingCalendar,
    ],
  )

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
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
