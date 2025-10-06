import { Stack, useRouter } from "expo-router"
import "./global.css"
import { StatusBar } from "react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import Toast, { BaseToast } from "react-native-toast-message"
import { useEffect, useRef, useState } from "react"
import { useLoyaltyStore } from "@/store/points"
import { getToken } from "@/services/authToken"
import {
  registerForPushNotificationsAsync,
  savePushToken,
  setupNotificationListeners,
  handleNotification,
  hasMembershipPopupExpired,
} from "@/services/notifications"
import { AuthProvider } from "@/store/authProvider"
import { useCartStore } from "@/store/cart"
import MembershipPopup from "@/_components/membershipAd"
import { getAnnouncements, getStoreHours } from "@/services/api"
import AnnouncementsPopup from "@/_components/announcementModal"
import { Announcements } from "@/utils/types"

export default function RootLayout() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null)
  const notificationListener = useRef<{ unsubscribe: () => void } | null>(null)
  const [modalVisible, setModalVisible] = useState(false)
  const [announcements, setAnnouncements] = useState<Announcements>([])
  const [showAnnounceModal, setShowAnnounceModal] = useState(true)
  const router = useRouter()

  useEffect(() => {
    // Check if user is authenticated
    const checkAuth = async () => {
      const token = await getToken()
      setIsAuthenticated(!!token)
    }

    checkAuth()
  }, [])

  useEffect(() => {
    const fetchInitialData = async () => {
      getStoreHours()
      const token = await getToken()
      const annoucementList = await getAnnouncements()
      setAnnouncements(annoucementList)

      if (token) {
        const showMembershipPopup = await hasMembershipPopupExpired()
        if (showMembershipPopup) {
          setModalVisible(true)
        }
        // Fetch loyalty points if user is authenticated
        useLoyaltyStore.getState().fetchPoints() // load fresh points on app start
        useCartStore.getState().fetchCart() // load cart items on app start
      }
    }
    fetchInitialData()
  }, [])

  useEffect(() => {
    // Only register for push notifications if the user is authenticated
    if (isAuthenticated) {
      // Register for push notifications
      const registerPushNotifications = async () => {
        await registerForPushNotificationsAsync().then((token) => {
          if (token) {
            // Save the token to the server
            savePushToken(token)
          }
        })
      }
      registerPushNotifications()

      // Set up notification listeners
      notificationListener.current = setupNotificationListeners(
        (notification) =>
          handleNotification(notification, (path) =>
            router.replace(path as Parameters<typeof router.replace>[0])
          )
      )
    }

    // Clean up listeners when component unmounts
    return () => {
      if (notificationListener.current) {
        notificationListener.current?.unsubscribe()
      }
    }
  }, [isAuthenticated])

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
          {announcements?.length > 0 && showAnnounceModal && (
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
