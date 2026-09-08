import * as Notifications from "expo-notifications"
import * as Device from "expo-device"
import { Alert, Linking, Platform } from "react-native"
import { getToken } from "./authToken"
import { apiRequest } from "./apiClient"
import * as SecureStore from "expo-secure-store"
import { getUsersMembership } from "./stripe-api"
import { getErrorMessage } from "../utils/getError"
import { addNZMonths } from "../lib/nzTime"

// Configure how notifications appear when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

/**
 * Register for push notifications and return the token
 */

const NEEDS_SIGN_IN =
  "Please sign in to receive notifications about your orders"

export async function registerForPushNotificationsAsync() {
  let token

  // Check if device is physical (not simulator/emulator)
  if (Device.isDevice) {
    // Check if we have permission, if not request it
    const { status: existingStatus } = await Notifications.getPermissionsAsync()

    let finalStatus = existingStatus

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync()
      finalStatus = status
    }

    // If we don't have permission, return null
    if (finalStatus !== "granted") {
      Alert.alert(
        "Notifications are disabled",
        "Please enable notifications in Settings to receive order updates.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Open Settings",
            onPress: () => {
              Linking.openSettings()
            },
          },
        ],
      )

      return null
    }
    // Get the token
    try {
      token = (
        await Notifications.getExpoPushTokenAsync({
          projectId: process.env.EXPO_PUBLIC_EXPO_PROJECT_ID!, // Your Expo project ID
        })
      ).data
    } catch (error) {
      console.error(getErrorMessage(error))
    }
  } else {
    console.log("Must use physical device for push notifications")
  }

  // For Android, we need to set up a notification channel
  if (Platform.OS === "android") {
    Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF231F7C",
    })
  }

  return token
}

/**
 * Save the push notification token to the server
 */
export async function savePushToken(pushToken: string) {
  try {
    await apiRequest("/api/notification/pushToken", {
      method: "POST",
      body: { pushToken },
      authMessage: NEEDS_SIGN_IN,
      errorMessage: "Failed to save push token",
    })

    return true
  } catch (error) {
    console.error("Error saving push token:", error)
    return false
  }
}

export async function removePushToken() {
  try {
    await apiRequest("/api/notification/removePushToken", {
      method: "POST",
      authMessage: NEEDS_SIGN_IN,
      errorMessage: "Failed to remove push token",
    })

    return true
  } catch (error) {
    console.error("Error removing push token:", error)
    return false
  }
}

export async function getPushToken(): Promise<string | null> {
  try {
    const data = await apiRequest<{ pushToken?: string | null }>(
      "/api/notification/getPushToken",
      { authMessage: NEEDS_SIGN_IN },
    )

    return data.pushToken ?? null
  } catch (error) {
    // A device with no token stored yet is the normal case on a fresh install,
    // and syncPushToken only needs to know it differs from the current one.
    console.error("Error getting push token:", error)
    return null
  }
}

/**
 * Set up notification listeners
 */
export function setupNotificationListeners(
  onNotification: (notification: Notifications.Notification) => void,
) {
  // This listener is fired whenever a notification is received while the app is foregrounded
  const foregroundSubscription =
    Notifications.addNotificationReceivedListener(onNotification)

  // This listener is fired whenever a user taps on or interacts with a notification
  const responseSubscription =
    Notifications.addNotificationResponseReceivedListener((response) => {
      const { notification } = response
      // Handle notification interaction
      onNotification(notification)
    })

  // Return the subscriptions so they can be unsubscribed later
  return {
    unsubscribe: () => {
      foregroundSubscription.remove()
      responseSubscription.remove()
    },
  }
}

/**
 * Handle a received notification
 */
export function handleNotification(
  notification: Notifications.Notification,
  onNavigate: (path: string) => void,
) {
  const data = notification.request.content.data

  // You can handle different notification types here
  if (data.type === "ORDER_STATUS_CHANGED") {
    // Navigate to the order details screen or update UI
    onNavigate("/orders")

    // You could use a navigation ref or event emitter to navigate
    // Example: navigationRef.current?.navigate('OrderDetails', { orderId: data.orderId })
  }
}

export const setMembershipPopupExpiration = async () => {
  // Stored and compared as an instant, so the timezone only decides how long
  // "a month" is. Stepping the store's calendar keeps that one definition.
  const expiration = addNZMonths(new Date(), 1) // 1 month later

  await SecureStore.setItemAsync(
    "showMembershipPopup",
    `${expiration.getTime()}`,
  )
}

// Read the flag and check if it has expired
export const hasMembershipPopupExpired = async (): Promise<boolean> => {
  try {
    // The local flag is checked first on purpose. For the common case — someone
    // who dismissed the popup within the last month — it settles the question
    // on its own, and asking the server first meant every launch paid an
    // authenticated round trip to reach the same answer.
    const dataStr = await SecureStore.getItemAsync("showMembershipPopup")
    const dismissalStillHolds = dataStr !== null && Date.now() <= Number(dataStr)

    if (dismissalStillHolds) return false

    // Past the dismissal window (or never dismissed), so membership is what
    // decides it: members are never shown the popup.
    const usersMembership = await getUsersMembership()
    if (usersMembership?.isActive) {
      return false
    }

    if (dataStr !== null) {
      // expired, remove it
      await SecureStore.deleteItemAsync("showMembershipPopup")
    }

    return true
  } catch {
    return true // fallback in case of corrupted data
  }
}

export async function syncPushToken() {
  try {
    const authToken = await getToken()
    if (!authToken) {
      return
    }
    // Independent of each other: one asks the OS and Expo's push service for a
    // token, the other asks our server what it already has on file. This runs
    // on every app foreground, so the serial version paid the sum all day.
    const [pushToken, storedToken] = await Promise.all([
      registerForPushNotificationsAsync(),
      getPushToken(),
    ])

    if (pushToken && pushToken !== storedToken) {
      await savePushToken(pushToken)
    }
  } catch (error) {
    console.error(error)
  }
}
