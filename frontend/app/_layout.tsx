import { SplashScreen, Stack, useRouter } from "expo-router"
import "./global.css"
import { AppState, StatusBar } from "react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import Toast, { BaseToast } from "react-native-toast-message"
import { useEffect, useRef, useState } from "react"
import * as Notifications from "expo-notifications"
import { useLoyaltyStore } from "@/store/points"
import { getToken } from "@/services/authToken"
import {
  registerForPushNotificationsAsync,
  savePushToken,
  handleNotification,
  hasMembershipPopupExpired,
  getPushToken,
  syncPushToken,
} from "@/services/notifications"
import { AuthProvider } from "@/store/authProvider"
import { useCartStore } from "@/store/cart"
import MembershipPopup from "@/_components/membershipAd"
import { getAnnouncements } from "@/services/api"
import AnnouncementsPopup from "@/_components/announcementModal"
import { Announcements } from "@/utils/types"
import AsyncStorage from "@react-native-async-storage/async-storage"

SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null)
  const notificationResponseListener =
    useRef<Notifications.EventSubscription | null>(null)
  const [modalVisible, setModalVisible] = useState(false)
  const [announcements, setAnnouncements] = useState<Announcements>([])
  const [showAnnounceModal, setShowAnnounceModal] = useState(false)
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const fetchPoints = useLoyaltyStore((state) => state.fetchPoints)
  const fetchCart = useCartStore((state) => state.fetchCart)

  useEffect(() => {
    setMounted(true) // mark that the router layout is mounted
  }, [])

  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const [token, announcementList] = await Promise.all([
          getToken(),
          getAnnouncements(),
        ])
        setIsAuthenticated(!!token)
        setAnnouncements(announcementList)
        if (announcementList.length > 0) {
          const lastSeenAnnouncement = await AsyncStorage.getItem(
            // get last seen announcement
            "lastSeenAnnouncement",
          )

          const hasNewAnnouncements = announcementList.some(
            // check if there are any new announcements
            (announcement) =>
              !lastSeenAnnouncement ||
              new Date(announcement.updatedAt) > new Date(lastSeenAnnouncement),
          )
          if (hasNewAnnouncements) {
            // show new announcements
            setShowAnnounceModal(true)
            const latestAnnouncementDate = announcementList.reduce(
              (latest, announcement) =>
                new Date(announcement.updatedAt) > new Date(latest)
                  ? announcement.updatedAt
                  : latest,
              announcementList[0].updatedAt,
            )

            await AsyncStorage.setItem(
              // store the newly seen announcement date
              "lastSeenAnnouncement",
              latestAnnouncementDate,
            )
          }
        }

        if (token) {
          const showMembershipPopup = await hasMembershipPopupExpired()
          if (showMembershipPopup) {
            setModalVisible(true)
          }
          // Fetch loyalty points if user is authenticated
          await Promise.all([fetchPoints(), fetchCart()]) // load fresh points on app start
          // load cart items on app start
        }
      } catch (error) {
        console.error("Failed to load announcements", error)
      } finally {
        await SplashScreen.hideAsync()
      }
    }

    fetchInitialData()
  }, [])

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
            if (mounted) {
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
  }, [isAuthenticated, mounted])

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
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar barStyle="dark-content" />

          <Stack
            screenOptions={{
              headerShown: false,
              headerTintColor: "#e6aa6b",
            }}
          />
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

          <Toast config={toastConfig} />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
