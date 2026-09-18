import { SplashScreen, Stack, useRouter } from "expo-router"
import "./global.css"
import { AppState, StatusBar, View } from "react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import Toast, { BaseToast } from "react-native-toast-message"
import { useEffect, useRef, useState } from "react"
import * as Notifications from "expo-notifications"
import { useLoyaltyStore } from "@/store/points"
import { getToken } from "@/services/authToken"
import {
  handleNotification,
  hasMembershipPopupExpired,
  syncPushToken,
} from "@/services/notifications"
import { AuthProvider } from "@/store/authProvider"
import { useCartStore } from "@/store/cart"
import MembershipPopup from "@/_components/membershipAd"
import { getAnnouncements } from "@/services/api"
import AnnouncementsPopup from "@/_components/announcementModal"
import { Announcements } from "@/utils/types"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { QueryClientProvider } from "@tanstack/react-query"
import { queryClient, subscribeAppStateFocus } from "@/services/queryClient"
import { useAppUpdateStore } from "@/store/appUpdate"
import UpdateRequiredScreen from "@/_components/updateRequiredScreen"
import UpdateNudgeModal from "@/_components/updateNudgeModal"

SplashScreen.preventAutoHideAsync()

// Module scope: a new object each render remounts every toast that is on screen.
// Wrapping has to be set here, not at the call site. Toast.show's `props` object
// arrives at BaseToast as a nested `props` key, which BaseToast never reads — it
// takes text1NumberOfLines from its own arguments, defaulting to one line. So a
// type without an entry below silently truncates its message to "One or more…".
const toastConfig = {
  error: (props: any) => (
    <BaseToast
      {...props}
      style={{ borderLeftColor: "red" }}
      contentContainerStyle={{ paddingHorizontal: 10 }}
      text1NumberOfLines={0} // allow wrapping
      text2NumberOfLines={0}
    />
  ),
  // Used when the server tells us it removed something from the cart. Those
  // messages are a full sentence, so they need the same wrapping.
  info: (props: any) => (
    <BaseToast
      {...props}
      style={{ borderLeftColor: "#87CEFA" }}
      contentContainerStyle={{ paddingHorizontal: 10 }}
      text1NumberOfLines={0}
      text2NumberOfLines={0}
    />
  ),
}

export default function RootLayout() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null)
  const notificationResponseListener =
    useRef<Notifications.EventSubscription | null>(null)
  const [modalVisible, setModalVisible] = useState(false)
  const [announcements, setAnnouncements] = useState<Announcements>([])
  const [showAnnounceModal, setShowAnnounceModal] = useState(false)
  const router = useRouter()
  // A ref, not state: this is only ever read inside a notification callback
  // that fires long after mount, so flipping it never needs to render — and as
  // a dependency below it was re-registering the notification listeners.
  const mounted = useRef(false)
  const fetchPoints = useLoyaltyStore((state) => state.fetchPoints)
  const fetchCart = useCartStore((state) => state.fetchCart)

  // Subscribing the root layout re-renders the whole tree when this moves, which
  // it does at most twice in a session. The rest of the store is read through
  // getState() below, so it adds no further subscriptions.
  const updateStatus = useAppUpdateStore((state) => state.status)
  // The dismissal is read back from AsyncStorage asynchronously. Offering the
  // nudge before that lands would ask again about a build already turned down.
  const updateStoreHydrated = useAppUpdateStore((state) => state.hydrated)
  const [showUpdateNudge, setShowUpdateNudge] = useState(false)
  const [launchPopupsResolved, setLaunchPopupsResolved] = useState(false)
  // Offered once per launch, whatever else happens afterwards.
  const nudgeOffered = useRef(false)

  useEffect(() => {
    mounted.current = true // mark that the router layout is mounted
  }, [])

  // React Native has no window focus event, so react-query needs AppState
  // pointed at it or refetch-on-focus never fires.
  useEffect(() => subscribeAppStateFocus(), [])

  // This wave is also what tells a retired build that it is one: getAnnouncements
  // goes through apiRequest, so the server's refusal is recorded before the
  // splash screen comes down. The .catch() below swallows the error, but
  // apiFetch has already marked the store by then — which is why that marking
  // lives in apiFetch and not in any caller. If this call ever goes away, a
  // blocked build would look normal until the customer touched something.
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        // One wave. The stored "last seen" date was previously read only after
        // the announcements came back, which made it a second serial hop for a
        // value that does not depend on them.
        const [token, announcementList, lastSeenAnnouncement] =
          await Promise.all([
            getToken(),
            getAnnouncements().catch((error): Announcements => {
              console.error("Failed to fetch announcements:", error)
              return []
            }),
            AsyncStorage.getItem("lastSeenAnnouncement").catch(
              (error): string | null => {
                console.error("Failed to read last seen announcement:", error)
                return null
              },
            ),
          ])
        setIsAuthenticated(!!token)
        setAnnouncements(announcementList)
        if (announcementList.length > 0) {
          const hasNewAnnouncements = announcementList.some(
            // check if there are any new announcements
            (announcement) =>
              !lastSeenAnnouncement ||
              new Date(announcement.updatedAt) > new Date(lastSeenAnnouncement),
          )
          if (hasNewAnnouncements) {
            // show new announcements
            setShowAnnounceModal(true)
            const latestAnnouncementDate = announcementList.reduce<string>(
              (latest, announcement) =>
                new Date(announcement.updatedAt) > new Date(latest)
                  ? announcement.updatedAt
                  : latest,
              announcementList[0].updatedAt,
            )

            // Nothing reads this back during startup, so awaiting a native
            // write only held the splash screen up for longer.
            void AsyncStorage.setItem(
              // store the newly seen announcement date
              "lastSeenAnnouncement",
              latestAnnouncementDate,
            ).catch((error) =>
              console.error("Failed to store last seen announcement:", error),
            )
          }
        }
      } catch (error) {
        console.error("Failed to load announcements", error)
      } finally {
        await SplashScreen.hideAsync()
      }
    }

    fetchInitialData()
  }, [])

  // Deliberately after the splash screen, not before it. The loyalty badge and
  // the cart pill are not on the home screen's first paint, and the membership
  // popup is a modal drawn over it — so none of this has to gate launch. These
  // also used to run in series behind hasMembershipPopupExpired(), which is
  // itself a network call.
  useEffect(() => {
    // Still reading the stored token; nothing has been decided yet.
    if (isAuthenticated === null) return

    if (!isAuthenticated) {
      // A signed-out customer never runs the wave below, so without this
      // nothing would ever report the launch popups as settled and the update
      // nudge would wait for a membership check that is not coming.
      setLaunchPopupsResolved(true)
      return
    }

    const loadPostLaunchData = async () => {
      const [popupResult] = await Promise.allSettled([
        hasMembershipPopupExpired(),
        fetchPoints(),
        fetchCart(),
      ])

      if (popupResult.status === "fulfilled" && popupResult.value) {
        setModalVisible(true)
      } else if (popupResult.status === "rejected") {
        console.error("Failed to check membership popup:", popupResult.reason)
      }
    }

    void loadPostLaunchData().finally(() => setLaunchPopupsResolved(true))
  }, [isAuthenticated, fetchPoints, fetchCart])

  /**
   * The nudge is a launch-time decision; the wall is a live one.
   *
   * A recommendation rides on whatever response happens to carry it, which can
   * be a cart quantity sync while the customer is on checkout with the payment
   * sheet open — no moment to suggest a trip to the App Store. So it is offered
   * only once the launch popups have settled, and behind both of them: unseen
   * shop news and the membership offer both matter more than "there is a newer
   * build". Because this re-runs as they close, it still appears in the same
   * session rather than waiting for the next launch.
   */
  useEffect(() => {
    if (nudgeOffered.current) return
    if (!launchPopupsResolved || !updateStoreHydrated) return
    if (modalVisible || showAnnounceModal) return

    const { status, recommendedBuild, dismissedBuild } =
      useAppUpdateStore.getState()

    if (status !== "recommended" || recommendedBuild === null) return
    if (recommendedBuild === dismissedBuild) return

    nudgeOffered.current = true
    setShowUpdateNudge(true)
  }, [
    launchPopupsResolved,
    updateStoreHydrated,
    modalVisible,
    showAnnounceModal,
    // Not read in the body — getState() is not reactive — but it is what makes
    // this re-run when a recommendation lands after the popups have settled.
    // Removing it as "unused" would mean the nudge only ever appeared on a
    // launch where the answer arrived first.
    updateStatus,
  ])

  useEffect(() => {
    // listen when app state changes (when user switches apps)
    if (!isAuthenticated) return

    const subscription = AppState.addEventListener("change", async (state) => {
      if (state === "active") {
        try {
          await syncPushToken()
        } catch (error) {
          console.error("Failed to sync push token:", error)
        }
      }
    })

    return () => subscription.remove()
  }, [isAuthenticated])

  useEffect(() => {
    // Only register for push notifications if the user is authenticated
    if (isAuthenticated) {
      // Register for push notifications
      const registerPushNotifications = async () => {
        try {
          await syncPushToken()
        } catch (error) {
          console.error("Failed to register push notifications:", error)
        }
      }
      registerPushNotifications()

      // Set up notification listeners
      notificationResponseListener.current =
        Notifications.addNotificationResponseReceivedListener((response) => {
          const notification = response.notification
          handleNotification(notification, (path) => {
            // wait for router to mount before navigating
            if (mounted.current) {
              router.replace(path as Parameters<typeof router.replace>[0])
            }
          })
        })
    }

    // Clean up listeners when component unmounts
    return () => {
      if (notificationResponseListener.current) {
        notificationResponseListener.current?.remove()
      }
    }
  }, [isAuthenticated, router])

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <AuthProvider>
            <StatusBar barStyle="dark-content" />

            <Stack
              screenOptions={{
                headerShown: false,
                headerTintColor: "#e6aa6b",
              }}
            />

            {/*
              Over the Stack, not instead of it. Unmounting the navigator would
              leave expo-router with none — the notification listener above still
              calls router.replace — and would throw away where the customer was,
              which matters because this wall can be lifted: the server only has
              to stop refusing, and "I've already updated" is what asks it.

              What is behind carries on rendering, but nothing behind can be
              reached, and every request it makes is refused and not retried.

              The launch popups are suppressed rather than covered: a React Native
              Modal is its own native window and would otherwise draw on top of
              the wall. Announcements especially, since dismissing one writes
              "last seen" and would quietly use up news nobody saw.
            */}
            {updateStatus === "required" ? (
              <View className="absolute inset-0">
                <UpdateRequiredScreen />
              </View>
            ) : (
              <>
                {modalVisible && (
                  <MembershipPopup
                    modalVisible={modalVisible}
                    setModalVisible={setModalVisible}
                  />
                )}
                {showAnnounceModal && (
                  <AnnouncementsPopup
                    showAnnounceModal={showAnnounceModal}
                    setShowAnnounceModal={setShowAnnounceModal}
                    announcements={announcements}
                  />
                )}
                {showUpdateNudge && (
                  <UpdateNudgeModal
                    onClose={() => setShowUpdateNudge(false)}
                  />
                )}
              </>
            )}

            <Toast config={toastConfig} />
          </AuthProvider>
        </SafeAreaProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  )
}
